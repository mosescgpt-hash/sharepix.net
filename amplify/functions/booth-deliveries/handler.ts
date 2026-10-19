import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { buildBoothMessage, formatRemovalDate, type BoothMessageKind } from './message';
import { deliveryDue, reminderDue, removalDue, type AttendeeState } from './plan';
import { originalsRemovedAt, reminderAt } from './retention';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;
const APP_URL = (process.env.APP_URL ?? 'https://www.sharepix.net').replace(/\/+$/, '');
const FROM_ADDRESS = process.env.REMINDER_FROM_ADDRESS || 'SharePix <noreply@sharepix.net>';
const REPLY_TO = process.env.REMINDER_REPLY_TO || 'support@sharepix.net';
/** The same master switch as all customer mail. Unset: decide and log, send nothing. */
const SENDING_ENABLED = (process.env.EMAIL_SENDING_ENABLED ?? '').toLowerCase() === 'true';
/** Bound one run, so a bad hour cannot become a bad day. */
const MAX_SENDS_PER_RUN = 1000;
/** A host's Resend can't be used to flood someone's inbox. */
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

/** Explicit in the schema so they cannot drift. */
const ATTENDEES_BY_EVENT = 'boothAttendeesByEventId';
const PHOTOS_BY_EVENT = 'photosByEventId';

interface BoothEvent {
  id: string;
  name: string;
  owner: string;
  removedAt: string | null;
  alreadyRemovedAt: string | null;
}

interface Attendee extends AttendeeState {
  id: string;
  name: string;
  galleryKey: string | null;
  lastDeliveredAt: string | null;
}

interface BoothPhoto {
  id: string;
  recipients: string[];
  approved: boolean;
  originalObjectKey: string | null;
}

function readEvent(item: Record<string, AttributeValue>): BoothEvent {
  return {
    id: item.id?.S ?? '',
    name: item.name?.S ?? '',
    owner: item.owner?.S ?? '',
    removedAt: originalsRemovedAt({ date: item.date?.S ?? null, createdAt: item.createdAt?.S ?? null }),
    alreadyRemovedAt: item.boothOriginalsRemovedAt?.S ?? null,
  };
}

function readAttendee(item: Record<string, AttributeValue>): Attendee {
  return {
    id: item.id?.S ?? '',
    name: item.name?.S ?? '',
    email: item.email?.S ?? null,
    galleryKey: item.galleryKey?.S ?? null,
    emailsStopped: item.emailsStopped?.BOOL === true,
    deliveredCount: Number(item.deliveredCount?.N ?? 0) || 0,
    reminderSentAt: item.reminderSentAt?.S ?? null,
    lastDeliveredAt: item.lastDeliveredAt?.S ?? null,
  };
}

function recipientsOf(item: Record<string, AttributeValue>): string[] {
  const list = item.boothAttendeeIds?.L?.map((v) => v.S ?? '').filter(Boolean) ?? [];
  if (list.length > 0) return list;
  return item.boothAttendeeId?.S ? [item.boothAttendeeId.S] : [];
}

async function loadAttendees(eventId: string): Promise<Attendee[]> {
  const out: Attendee[] = [];
  let start: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: ATTENDEE_TABLE,
        IndexName: ATTENDEES_BY_EVENT,
        KeyConditionExpression: 'eventId = :event',
        ExpressionAttributeValues: { ':event': { S: eventId } },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) out.push(readAttendee(item));
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
}

/** Every booth photo at the event, approved or not (removal needs them all). */
async function loadPhotos(eventId: string): Promise<BoothPhoto[]> {
  const out: BoothPhoto[] = [];
  let start: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: PHOTO_TABLE,
        IndexName: PHOTOS_BY_EVENT,
        KeyConditionExpression: 'eventId = :event',
        FilterExpression: 'attribute_exists(boothMatch)',
        ExpressionAttributeValues: { ':event': { S: eventId } },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of page.Items ?? []) {
      out.push({
        id: item.id?.S ?? '',
        recipients: recipientsOf(item),
        approved: item.publishStatus?.S === 'approved',
        originalObjectKey: item.originalObjectKey?.S ?? null,
      });
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
}

/** How many approved photos each person has: what their gallery shows. */
function approvedCounts(photos: BoothPhoto[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const photo of photos) {
    if (!photo.approved) continue;
    for (const id of new Set(photo.recipients)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function isConditionFailure(error: unknown): boolean {
  return (error as { name?: string }).name === 'ConditionalCheckFailedException';
}

/**
 * Claim a delivery before sending it: the count moves from what this run read
 * to the new total, so an overlapping run or a retry finds it moved and sends
 * nothing. Released below if the send fails, so it is retried next hour.
 */
async function claimDelivery(attendee: Attendee, total: number, nowISO: string): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendee.id } },
        UpdateExpression: 'SET deliveredCount = :total, lastDeliveredAt = :now, updatedAt = :now',
        ConditionExpression:
          'attribute_exists(id) AND (attribute_not_exists(emailsStopped) OR emailsStopped = :false) AND ' +
          (attendee.deliveredCount === 0
            ? '(attribute_not_exists(deliveredCount) OR deliveredCount = :zero)'
            : 'deliveredCount = :old'),
        ExpressionAttributeValues: {
          ':total': { N: String(total) },
          ':now': { S: nowISO },
          ':false': { BOOL: false },
          ...(attendee.deliveredCount === 0
            ? { ':zero': { N: '0' } }
            : { ':old': { N: String(attendee.deliveredCount) } }),
        },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}

async function releaseDelivery(attendee: Attendee, total: number): Promise<void> {
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendee.id } },
        UpdateExpression: attendee.lastDeliveredAt
          ? 'SET deliveredCount = :old, lastDeliveredAt = :last'
          : 'SET deliveredCount = :old REMOVE lastDeliveredAt',
        ConditionExpression: 'deliveredCount = :total',
        ExpressionAttributeValues: {
          ':old': { N: String(attendee.deliveredCount) },
          ':total': { N: String(total) },
          ...(attendee.lastDeliveredAt ? { ':last': { S: attendee.lastDeliveredAt } } : {}),
        },
      }),
    )
    .catch((error) => console.error('Could not release a delivery claim', { id: attendee.id, error: String(error) }));
}

async function claimReminder(attendee: Attendee, nowISO: string): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendee.id } },
        UpdateExpression: 'SET reminderSentAt = :now, updatedAt = :now',
        ConditionExpression:
          'attribute_exists(id) AND attribute_not_exists(reminderSentAt) AND (attribute_not_exists(emailsStopped) OR emailsStopped = :false)',
        ExpressionAttributeValues: { ':now': { S: nowISO }, ':false': { BOOL: false } },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionFailure(error)) return false;
    throw error;
  }
}

async function releaseReminder(attendee: Attendee): Promise<void> {
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendee.id } },
        UpdateExpression: 'REMOVE reminderSentAt',
      }),
    )
    .catch((error) => console.error('Could not release a reminder claim', { id: attendee.id, error: String(error) }));
}

async function send(
  attendee: Attendee,
  event: BoothEvent,
  kind: BoothMessageKind,
  photoCount: number,
): Promise<boolean> {
  if (!attendee.email || !attendee.galleryKey) return false;
  const galleryUrl = `${APP_URL}/booth/photos/${attendee.galleryKey}`;
  const stopUrl = `${galleryUrl}?stop=1`;
  const message = buildBoothMessage({
    kind,
    attendeeName: attendee.name,
    eventName: event.name,
    galleryUrl,
    stopUrl,
    photoCount,
    removedOn: formatRemovalDate(event.removedAt),
  });
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [attendee.email] },
        ReplyToAddresses: [REPLY_TO],
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
            // The link, not one-click POST, as on the upload reminders.
            Headers: [{ Name: 'List-Unsubscribe', Value: `<${stopUrl}>` }],
          },
        },
      }),
    );
    return true;
  } catch (error) {
    // The address is deliberately not logged.
    console.error('Could not send a booth email', {
      eventId: event.id,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Remove the event's full-resolution originals. The previews stay, so a
 * gallery still shows what was taken. Each photo row loses its
 * originalObjectKey only after its object is gone, and the event is marked
 * done only when every one went, so a partial run finishes next hour.
 */
async function removeOriginals(event: BoothEvent, photos: BoothPhoto[], nowISO: string): Promise<number> {
  let removed = 0;
  let failed = 0;
  for (const photo of photos) {
    if (!photo.originalObjectKey) continue;
    // Only under pro/, whatever a row says.
    if (!photo.originalObjectKey.startsWith('pro/')) continue;
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: photo.originalObjectKey }));
      await dynamo.send(
        new UpdateItemCommand({
          TableName: PHOTO_TABLE,
          Key: { id: { S: photo.id } },
          UpdateExpression: 'REMOVE originalObjectKey SET updatedAt = :now',
          ConditionExpression: 'attribute_exists(id)',
          ExpressionAttributeValues: { ':now': { S: nowISO } },
        }),
      );
      removed += 1;
    } catch (error) {
      failed += 1;
      console.error('Could not remove a booth original', { photoId: photo.id, error: String(error) });
    }
  }
  if (failed === 0) {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: event.id } },
        UpdateExpression: 'SET boothOriginalsRemovedAt = :now',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':now': { S: nowISO } },
      }),
    );
  }
  return removed;
}

interface JobResult {
  ok: boolean;
  dryRun: boolean;
  summary: string;
}

async function run(): Promise<JobResult> {
  const nowISO = new Date().toISOString();
  const counts = { delivered: 0, reminded: 0, wouldSend: 0, failed: 0, skippedOverCap: 0, originalsRemoved: 0 };
  const capped = () => counts.delivered + counts.reminded + counts.wouldSend >= MAX_SENDS_PER_RUN;

  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: EVENT_TABLE,
        FilterExpression: 'boothMode = :true AND attribute_not_exists(takenDownAt)',
        ProjectionExpression: 'id, #name, #owner, #date, createdAt, boothOriginalsRemovedAt',
        ExpressionAttributeNames: { '#name': 'name', '#owner': 'owner', '#date': 'date' },
        ExpressionAttributeValues: { ':true': { BOOL: true } },
        ExclusiveStartKey: startKey,
      }),
    );
    startKey = page.LastEvaluatedKey;

    for (const item of page.Items ?? []) {
      const event = readEvent(item);
      // Past removal there is nothing left to deliver or remind about.
      if (event.alreadyRemovedAt) continue;
      try {
        const photos = await loadPhotos(event.id);

        // Removal is cleanup, not mail: it runs whether or not sending is on.
        if (removalDue(nowISO, event.removedAt, event.alreadyRemovedAt)) {
          counts.originalsRemoved += await removeOriginals(event, photos, nowISO);
          continue;
        }

        const approved = approvedCounts(photos);
        const remindFrom = event.removedAt ? reminderAt(event.removedAt) : null;
        for (const attendee of await loadAttendees(event.id)) {
          const total = approved.get(attendee.id) ?? 0;
          const delivery = deliveryDue(attendee, total);
          const remind = !delivery && reminderDue(attendee, nowISO, remindFrom, event.removedAt);
          if (!delivery && !remind) continue;
          if (!attendee.galleryKey) continue;
          if (capped()) {
            counts.skippedOverCap += 1;
            continue;
          }
          if (!SENDING_ENABLED) {
            // Nothing is claimed in a dry run, so turning sending on later
            // sends what was due rather than treating it as done.
            counts.wouldSend += 1;
            console.log('Would send a booth email', { eventId: event.id, kind: delivery ?? 'reminder' });
            continue;
          }
          if (delivery) {
            if (!(await claimDelivery(attendee, total, nowISO))) continue;
            if (await send(attendee, event, delivery, total)) counts.delivered += 1;
            else {
              counts.failed += 1;
              await releaseDelivery(attendee, total);
            }
          } else {
            if (!(await claimReminder(attendee, nowISO))) continue;
            if (await send(attendee, event, 'reminder', total)) counts.reminded += 1;
            else {
              counts.failed += 1;
              await releaseReminder(attendee);
            }
          }
        }
      } catch (error) {
        // One event's trouble doesn't stop the rest.
        counts.failed += 1;
        console.error('Booth event failed', { eventId: event.id, error: String(error) });
      }
    }
  } while (startKey);

  const parts = SENDING_ENABLED
    ? [`Sent ${counts.delivered} photo email${counts.delivered === 1 ? '' : 's'} and ${counts.reminded} reminder${counts.reminded === 1 ? '' : 's'}.`]
    : [`Nothing was sent: EMAIL_SENDING_ENABLED is off. ${counts.wouldSend} would have gone out.`];
  if (counts.failed) parts.push(`${counts.failed} failed and will retry next hour.`);
  if (counts.skippedOverCap) parts.push(`${counts.skippedOverCap} held for the next run (per-run cap).`);
  parts.push(`Removed ${counts.originalsRemoved} original${counts.originalsRemoved === 1 ? '' : 's'}.`);
  console.log('booth-deliveries', { ...counts, sendingEnabled: SENDING_ENABLED });
  return { ok: counts.failed === 0, dryRun: !SENDING_ENABLED, summary: parts.join(' ') };
}

/** Same rule as update-event: "<sub>::<loginId>", compared by first segment. */
export function mayManage(
  caller: { sub?: string | null; groups?: string[] | null } | null | undefined,
  owner: string,
): boolean {
  if ((caller?.groups ?? []).includes('ADMINS')) return true;
  const sub = caller?.sub;
  if (!sub || !owner) return false;
  return owner.split('::')[0] === sub;
}

interface ResendResult {
  ok: boolean;
  message: string;
}

/**
 * The host's Resend button: send one attendee their gallery link now. Only
 * the event's owner (or an admin), only to someone who hasn't stopped emails,
 * only when they have approved photos, and not twice in five minutes.
 */
async function resend(
  args: { eventId?: string | null; attendeeId?: string | null },
  caller: { sub?: string | null; groups?: string[] | null } | null | undefined,
): Promise<ResendResult> {
  const eventId = String(args.eventId ?? '');
  const attendeeId = String(args.attendeeId ?? '');
  const notFound = { ok: false, message: 'That attendee could not be found.' };
  if (!eventId || !attendeeId) return notFound;

  const ev = await dynamo.send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }));
  if (!ev.Item || ev.Item.boothMode?.BOOL !== true) return notFound;
  const event = readEvent(ev.Item);
  if (!mayManage(caller, event.owner)) return notFound;

  const row = await dynamo.send(new GetItemCommand({ TableName: ATTENDEE_TABLE, Key: { id: { S: attendeeId } } }));
  if (!row.Item || row.Item.eventId?.S !== eventId) return notFound;
  const attendee = readAttendee(row.Item);

  if (attendee.emailsStopped) return { ok: false, message: 'They turned off these emails, so nothing was sent.' };
  if (!attendee.email || !attendee.galleryKey) return { ok: false, message: 'They have no email on file.' };
  if (event.alreadyRemovedAt) return { ok: false, message: 'The originals for this event have been removed.' };
  const total = approvedCounts(await loadPhotos(eventId)).get(attendeeId) ?? 0;
  if (total === 0) return { ok: false, message: 'They have no approved photos yet.' };
  if (attendee.lastDeliveredAt && Date.now() - Date.parse(attendee.lastDeliveredAt) < RESEND_COOLDOWN_MS) {
    return { ok: false, message: 'They were emailed in the last few minutes. Try again shortly.' };
  }
  if (!SENDING_ENABLED) return { ok: false, message: 'Email sending is switched off, so nothing was sent.' };

  const nowISO = new Date().toISOString();
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendeeId } },
        UpdateExpression: 'SET deliveredCount = :total, lastDeliveredAt = :now, updatedAt = :now',
        ConditionExpression: attendee.lastDeliveredAt
          ? 'lastDeliveredAt = :last AND (attribute_not_exists(emailsStopped) OR emailsStopped = :false)'
          : 'attribute_not_exists(lastDeliveredAt) AND (attribute_not_exists(emailsStopped) OR emailsStopped = :false)',
        ExpressionAttributeValues: {
          ':total': { N: String(Math.max(total, attendee.deliveredCount)) },
          ':now': { S: nowISO },
          ':false': { BOOL: false },
          ...(attendee.lastDeliveredAt ? { ':last': { S: attendee.lastDeliveredAt } } : {}),
        },
      }),
    );
  } catch (error) {
    if (isConditionFailure(error)) return { ok: false, message: 'They were just emailed.' };
    throw error;
  }
  if (!(await send(attendee, event, 'ready', total))) {
    return { ok: false, message: 'The email could not be sent. Try again in a moment.' };
  }
  return { ok: true, message: `Sent to ${attendee.email}.` };
}

interface InvocationEvent {
  arguments?: { eventId?: string | null; attendeeId?: string | null };
  identity?: { sub?: string | null; groups?: string[] | null } | null;
  info?: { fieldName?: string };
}

/** Invoked hourly by the schedule, and by boothResendEmail from the host's attendee list. */
export const handler = async (event: InvocationEvent): Promise<JobResult | ResendResult> => {
  if (event?.info?.fieldName === 'boothResendEmail') {
    try {
      return await resend(event.arguments ?? {}, event.identity);
    } catch (error) {
      console.error('boothResendEmail failed', error);
      return { ok: false, message: 'The email could not be sent. Try again in a moment.' };
    }
  }
  try {
    return await run();
  } catch (error) {
    console.error('booth-deliveries failed', error);
    return {
      ok: false,
      dryRun: !SENDING_ENABLED,
      summary: `The run stopped: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
