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
import { CheckIfPhoneNumberIsOptedOutCommand, PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { buildBoothSms } from './sms';
import { buildBoothMessage, formatRemovalDate, type BoothMessageKind } from './message';
import { channelsFor, deliveryDue, reminderDue, removalDue, type AttendeeState } from './plan';
import { originalsRemovedAt, reminderAt } from './retention';
import {
  DELIVERY_SETTLE_MS,
  checkLinkEmail,
  linkEmailRefusal,
  maskEmail,
  promptDeliveryAllowed,
  LINK_EMAIL_COOLDOWN_MS,
  MAX_LINK_EMAILS,
} from './linkEmail';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});
const ses = new SESv2Client({});
const sns = new SNSClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;
const APP_URL = (process.env.APP_URL ?? 'https://www.sharepix.net').replace(/\/+$/, '');
const FROM_ADDRESS = process.env.REMINDER_FROM_ADDRESS || 'SharePix <noreply@sharepix.net>';
const REPLY_TO = process.env.REMINDER_REPLY_TO || 'support@sharepix.net';
/** The same master switch as all customer mail. Unset: decide and log, send nothing. */
const SENDING_ENABLED = (process.env.EMAIL_SENDING_ENABLED ?? '').toLowerCase() === 'true';
/**
 * Texting has its own switch, off by default, because it needs an approved
 * toll-free number first (SMS_SETUP.md). Off: no texts, and phone-only
 * attendees are simply not due. Email is unaffected.
 */
const SMS_ENABLED = (process.env.BOOTH_SMS_ENABLED ?? '').toLowerCase() === 'true';
/** Optional origination number (the approved toll-free number), E.164. */
const SMS_ORIGINATION = process.env.BOOTH_SMS_ORIGINATION_NUMBER ?? '';
/** Bound one run, so a bad hour cannot become a bad day. */
const MAX_SENDS_PER_RUN = 1000;
/** A host's Resend can't be used to flood someone's inbox. */
const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

/** Explicit in the schema so they cannot drift. */
const ATTENDEES_BY_EVENT = 'boothAttendeesByEventId';
const ATTENDEES_BY_GALLERY_KEY = 'boothAttendeesByGalleryKey';
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
  /** "Email me my link" (linkEmail.ts): when it last went, and how often. */
  linkEmailedAt: string | null;
  linkEmailCount: number;
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
    phone: item.phone?.S ?? null,
    smsConsent: Boolean(item.smsConsentAt?.S),
    smsStopped: item.smsStopped?.BOOL === true,
    galleryKey: item.galleryKey?.S ?? null,
    emailsStopped: item.emailsStopped?.BOOL === true,
    deliveredCount: Number(item.deliveredCount?.N ?? 0) || 0,
    reminderSentAt: item.reminderSentAt?.S ?? null,
    lastDeliveredAt: item.lastDeliveredAt?.S ?? null,
    linkEmailedAt: item.linkEmailedAt?.S ?? null,
    linkEmailCount: Number(item.linkEmailCount?.N ?? 0) || 0,
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
        // A QR divider shot is never anyone's photo.
        recipients: item.boothMatch?.S === 'divider' ? [] : recipientsOf(item),
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
        // Email-only attendees: re-check "stop" at claim time. Anyone who can
        // be texted is re-checked against the carrier opt-out list at send.
        ConditionExpression:
          'attribute_exists(id) AND (attribute_not_exists(emailsStopped) OR emailsStopped = :false OR :sms = :true) AND ' +
          (attendee.deliveredCount === 0
            ? '(attribute_not_exists(deliveredCount) OR deliveredCount = :zero)'
            : 'deliveredCount = :old'),
        ExpressionAttributeValues: {
          ':total': { N: String(total) },
          ':now': { S: nowISO },
          ':false': { BOOL: false },
          ':true': { BOOL: true },
          ':sms': { BOOL: channelsFor(attendee, 'ready', SMS_ENABLED).sms },
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
          'attribute_exists(id) AND attribute_not_exists(reminderSentAt) AND (attribute_not_exists(emailsStopped) OR emailsStopped = :false OR :sms = :true)',
        ExpressionAttributeValues: {
          ':now': { S: nowISO },
          ':false': { BOOL: false },
          ':true': { BOOL: true },
          ':sms': { BOOL: channelsFor(attendee, 'reminder', SMS_ENABLED).sms },
        },
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

/**
 * One text. Checks the carrier opt-out list first (someone who replied STOP
 * to any SharePix text is on it) and records it on the row so we stop trying.
 */
async function sendSms(attendee: Attendee, event: BoothEvent, kind: 'ready' | 'reminder'): Promise<boolean> {
  if (!attendee.phone || !attendee.galleryKey) return false;
  try {
    const opted = await sns.send(new CheckIfPhoneNumberIsOptedOutCommand({ phoneNumber: attendee.phone }));
    if (opted.isOptedOut) {
      await dynamo
        .send(
          new UpdateItemCommand({
            TableName: ATTENDEE_TABLE,
            Key: { id: { S: attendee.id } },
            UpdateExpression: 'SET smsStopped = :true',
            ExpressionAttributeValues: { ':true': { BOOL: true } },
          }),
        )
        .catch(() => undefined);
      return false;
    }
    await sns.send(
      new PublishCommand({
        PhoneNumber: attendee.phone,
        Message: buildBoothSms({ kind, eventName: event.name, galleryUrl: `${APP_URL}/booth/photos/${attendee.galleryKey}` }),
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
          ...(SMS_ORIGINATION
            ? { 'AWS.MM.SMS.OriginationNumber': { DataType: 'String', StringValue: SMS_ORIGINATION } }
            : {}),
        },
      }),
    );
    return true;
  } catch (error) {
    // The number is deliberately not logged.
    console.error('Could not send a booth text', {
      eventId: event.id,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Email and/or text, per channelsFor. True when at least one went. */
async function send(
  attendee: Attendee,
  event: BoothEvent,
  kind: Exclude<BoothMessageKind, 'session'>,
  photoCount: number,
): Promise<boolean> {
  const ch = channelsFor(attendee, kind, SMS_ENABLED);
  const emailed = ch.email ? await sendEmail(attendee, event, kind, photoCount) : false;
  const texted = ch.sms ? await sendSms(attendee, event, kind === 'reminder' ? 'reminder' : 'ready') : false;
  return emailed || texted;
}

async function sendEmail(
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
          const delivery = deliveryDue(attendee, total, SMS_ENABLED);
          const remind = !delivery && reminderDue(attendee, nowISO, remindFrom, event.removedAt, SMS_ENABLED);
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
  // Resend is email only; a host cannot trigger texts.
  if (!(await sendEmail(attendee, event, 'ready', total))) {
    return { ok: false, message: 'The email could not be sent. Try again in a moment.' };
  }
  // Never the address itself: hosts do not see guests' contact details.
  return { ok: true, message: 'Sent their photo link again.' };
}

interface LinkResult {
  ok: boolean;
  message: string;
  /** "j***@example.com": the address the link goes to, masked. Null when none. */
  emailHint: string | null;
  /** True when an email went out on this call. */
  sent: boolean;
}

/** The same shape for a wrong key and a missing one: nothing to enumerate. */
const LINK_NOT_FOUND: LinkResult = {
  ok: false,
  message: 'This link is not valid.',
  emailHint: null,
  sent: false,
};

/** Same rule as booth-gallery/gallery.ts isGalleryKey (a Lambda cannot import it). */
function isGalleryKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(key);
}

async function attendeeByKey(key: string): Promise<Record<string, AttributeValue> | null> {
  const found = await dynamo.send(
    new QueryCommand({
      TableName: ATTENDEE_TABLE,
      IndexName: ATTENDEES_BY_GALLERY_KEY,
      KeyConditionExpression: 'galleryKey = :key',
      ExpressionAttributeValues: { ':key': { S: key } },
      Limit: 2,
    }),
  );
  return found.Items?.length === 1 ? found.Items[0] : null;
}

async function approvedFor(eventId: string, attendeeId: string): Promise<number> {
  return approvedCounts(await loadPhotos(eventId)).get(attendeeId) ?? 0;
}

/**
 * boothEmailMyLink: a guest tapped Stop on their capture page.
 *
 * The 192-bit gallery key is the whole authorization, as for the gallery. A
 * wrong key gets the same answer as a missing one, and the answer never
 * includes anyone else's details. If they already have an address on file the
 * link goes there; if not, they may give one with their tick (and it is only
 * ever saved when none was). Never to someone who stopped emails; at most once
 * per 10 minutes and five times in all (linkEmail.ts); claimed with a
 * conditional write before sending, so a double tap sends once.
 */
async function emailMyLink(args: {
  key?: string | null;
  email?: string | null;
  consent?: boolean | null;
}): Promise<LinkResult> {
  const key = String(args.key ?? '').trim();
  if (!isGalleryKey(key)) return LINK_NOT_FOUND;
  const row = await attendeeByKey(key);
  const attendeeId = row?.id?.S;
  const eventId = row?.eventId?.S;
  if (!row || !attendeeId || !eventId) return LINK_NOT_FOUND;

  const ev = await dynamo.send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }));
  if (!ev.Item || ev.Item.boothMode?.BOOL !== true || ev.Item.takenDownAt?.S) return LINK_NOT_FOUND;
  const event = readEvent(ev.Item);

  let attendee = readAttendee(row);
  if (attendee.emailsStopped) {
    return { ok: false, message: 'You turned off emails about these photos, so nothing was sent.', emailHint: null, sent: false };
  }

  const nowISO = new Date().toISOString();
  if (!attendee.email) {
    const given = (args.email ?? '').toString().trim();
    // Nothing typed: the page is only asking whether there is an address.
    if (!given) return { ok: true, message: '', emailHint: null, sent: false };
    const checked = checkLinkEmail({ email: given, consent: args.consent });
    if (!checked.ok) return { ok: false, message: checked.reason, emailHint: null, sent: false };
    if (!SENDING_ENABLED) {
      return { ok: false, message: 'Email is not switched on yet, so nothing was sent.', emailHint: null, sent: false };
    }
    // Only ever fills a gap: an address already on file is never replaced by
    // whoever holds the key.
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: ATTENDEE_TABLE,
          Key: { id: { S: attendeeId } },
          UpdateExpression: 'SET email = :email, contactLabel = :label, emailConsentAt = :now, updatedAt = :now',
          ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(email)',
          ExpressionAttributeValues: {
            ':email': { S: checked.email },
            ':label': { S: maskEmail(checked.email) ?? 'Guest' },
            ':now': { S: nowISO },
          },
        }),
      );
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
    }
    const again = await dynamo.send(new GetItemCommand({ TableName: ATTENDEE_TABLE, Key: { id: { S: attendeeId } } }));
    if (!again.Item) return LINK_NOT_FOUND;
    attendee = readAttendee(again.Item);
  }

  const hint = maskEmail(attendee.email);
  if (!attendee.email || !attendee.galleryKey) return { ok: true, message: '', emailHint: null, sent: false };
  if (!SENDING_ENABLED) {
    return { ok: false, message: 'Email is not switched on yet, so nothing was sent.', emailHint: hint, sent: false };
  }
  const refusal = linkEmailRefusal(attendee, Date.now());
  if (refusal === 'stopped') {
    return { ok: false, message: 'You turned off emails about these photos, so nothing was sent.', emailHint: null, sent: false };
  }
  if (refusal) {
    // Already on its way (or as many as we send): the same friendly answer.
    return { ok: true, message: 'Your link was emailed a moment ago.', emailHint: hint, sent: false };
  }

  // Claim before sending: a double tap or a retry finds the stamp and sends nothing.
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendeeId } },
        UpdateExpression: 'SET linkEmailedAt = :now, linkEmailCount = if_not_exists(linkEmailCount, :zero) + :one, updatedAt = :now',
        ConditionExpression:
          'attribute_exists(id) AND (attribute_not_exists(emailsStopped) OR emailsStopped = :false) AND ' +
          '(attribute_not_exists(linkEmailedAt) OR linkEmailedAt < :cutoff) AND ' +
          '(attribute_not_exists(linkEmailCount) OR linkEmailCount < :max)',
        ExpressionAttributeValues: {
          ':now': { S: nowISO },
          ':cutoff': { S: new Date(Date.now() - LINK_EMAIL_COOLDOWN_MS).toISOString() },
          ':max': { N: String(MAX_LINK_EMAILS) },
          ':zero': { N: '0' },
          ':one': { N: '1' },
          ':false': { BOOL: false },
        },
      }),
    );
  } catch (error) {
    if (isConditionFailure(error)) {
      return { ok: true, message: 'Your link was emailed a moment ago.', emailHint: hint, sent: false };
    }
    throw error;
  }

  const total = await approvedFor(eventId, attendeeId);
  if (!(await sendEmail(attendee, event, 'session', total))) {
    // Give the claim back, so a retry is not treated as a repeat.
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: ATTENDEE_TABLE,
          Key: { id: { S: attendeeId } },
          UpdateExpression: 'REMOVE linkEmailedAt SET linkEmailCount = linkEmailCount - :one',
          ConditionExpression: 'linkEmailedAt = :now',
          ExpressionAttributeValues: { ':one': { N: '1' }, ':now': { S: nowISO } },
        }),
      )
      .catch((error) => console.error('Could not release a link email claim', { id: attendeeId, error: String(error) }));
    return { ok: false, message: 'We could not send the email just now. Your link above still works.', emailHint: hint, sent: false };
  }
  return { ok: true, message: 'Your link is on its way.', emailHint: hint, sent: true };
}

/** What a prompt delivery did, for the logs. */
interface DeliverNowResult {
  ok: boolean;
  summary: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The host approved a booth photo: email "ready" / "more" to the people in it
 * now, not at the next hourly run. Called only by decide-pro-photo (an
 * asynchronous Lambda invoke, which only that function may make; AppSync
 * calls never carry a `task`). It waits a minute first, so a host working
 * through a queue sends one email for the batch, then does exactly what the
 * hourly job does for each person: deliveryDue, then the same conditional
 * claim on deliveredCount, so the two never double-send. A "more" also waits
 * out a 10-minute gap from the last delivery; the hourly run takes the rest.
 */
async function deliverNow(
  task: { eventId?: string | null; attendeeIds?: string[] | null },
  settleMs: number,
): Promise<DeliverNowResult> {
  const eventId = String(task.eventId ?? '');
  const ids = [...new Set((task.attendeeIds ?? []).map(String).filter(Boolean))].slice(0, 25);
  if (!eventId || ids.length === 0) return { ok: true, summary: 'Nothing to do.' };
  if (!SENDING_ENABLED) return { ok: true, summary: 'Email sending is off; the hourly job will decide.' };

  if (settleMs > 0) await sleep(settleMs);

  const ev = await dynamo.send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }));
  if (!ev.Item || ev.Item.boothMode?.BOOL !== true || ev.Item.takenDownAt?.S) return { ok: true, summary: 'Not a live booth.' };
  const event = readEvent(ev.Item);
  if (event.alreadyRemovedAt || removalDue(new Date().toISOString(), event.removedAt, event.alreadyRemovedAt)) {
    return { ok: true, summary: 'Past removal; nothing to deliver.' };
  }

  const approved = approvedCounts(await loadPhotos(eventId));
  let delivered = 0;
  let failed = 0;
  for (const id of ids) {
    const row = await dynamo.send(new GetItemCommand({ TableName: ATTENDEE_TABLE, Key: { id: { S: id } } }));
    if (!row.Item || row.Item.eventId?.S !== eventId) continue;
    const attendee = readAttendee(row.Item);
    if (!attendee.galleryKey) continue;
    const total = approved.get(id) ?? 0;
    const kind = deliveryDue(attendee, total, SMS_ENABLED);
    if (!kind || !promptDeliveryAllowed(kind, attendee.lastDeliveredAt, Date.now())) continue;
    const nowISO = new Date().toISOString();
    if (!(await claimDelivery(attendee, total, nowISO))) continue;
    if (await send(attendee, event, kind, total)) delivered += 1;
    else {
      failed += 1;
      await releaseDelivery(attendee, total);
    }
  }
  console.log('booth-deliveries deliver-now', { eventId, delivered, failed });
  return { ok: failed === 0, summary: `Sent ${delivered}, ${failed} failed.` };
}

interface InvocationEvent {
  arguments?: {
    eventId?: string | null;
    attendeeId?: string | null;
    key?: string | null;
    email?: string | null;
    consent?: boolean | null;
  };
  /** Set only by decide-pro-photo's direct invoke (see deliverNow). */
  task?: string;
  settleMs?: number;
  eventId?: string;
  attendeeIds?: string[];
  identity?: { sub?: string | null; groups?: string[] | null } | null;
  info?: { fieldName?: string };
  fieldName?: string;
}

/** Invoked hourly by the schedule, and by boothResendEmail from the host's attendee list. */
export const handler = async (
  event: InvocationEvent,
): Promise<JobResult | ResendResult | LinkResult | DeliverNowResult> => {
  const field = event?.info?.fieldName ?? event?.fieldName;
  if (field === 'boothEmailMyLink') {
    try {
      return await emailMyLink(event.arguments ?? {});
    } catch (error) {
      console.error('boothEmailMyLink failed', error instanceof Error ? error.message : String(error));
      return { ok: false, message: 'We could not send the email just now. Your link still works.', emailHint: null, sent: false };
    }
  }
  // A direct invoke from decide-pro-photo. An AppSync call always has `info`.
  if (!event?.info && !event?.fieldName && !event?.arguments && event?.task === 'deliver-now') {
    try {
      // settleMs is only for tests (0); anything else waits the usual minute, never longer than two.
      const settle = Number.isFinite(event.settleMs) ? Math.min(Math.max(0, Number(event.settleMs)), 120_000) : DELIVERY_SETTLE_MS;
      return await deliverNow(event, settle);
    } catch (error) {
      console.error('deliver-now failed', error instanceof Error ? error.message : String(error));
      return { ok: false, summary: 'The prompt delivery failed; the hourly job will retry.' };
    }
  }
  if (field === 'boothResendEmail') {
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
