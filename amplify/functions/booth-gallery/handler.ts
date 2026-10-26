import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash, randomUUID } from 'node:crypto';
import { GUEST_UPLOAD_MESSAGES, MAX_GUEST_UPLOADS, guestUploadRefusal } from './boothControl';
import { readBoothLink } from './boothLink';
import { openContact } from './boothSeal';
import { sharedGalleryFor } from './sharedGallery';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  LINK_TTL_SECONDS,
  MAX_GALLERY_PHOTOS,
  downloadName,
  inGallery,
  isGalleryKey,
} from './gallery';
import { originalsRemovedAt } from './retention';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;
const BOOTH_PRIVATE_KEY = process.env.BOOTH_PRIVATE_KEY ?? '';
const ATTENDEES_BY_TOKEN = 'boothAttendeesByToken';

/** Explicit in the schema so it cannot drift. */
const ATTENDEES_BY_GALLERY_KEY = 'boothAttendeesByGalleryKey';
const PHOTOS_BY_EVENT = 'photosByEventId';

const NOT_FOUND = {
  ok: false,
  message: 'This gallery link is not valid. Check the email it came in.',
  eventName: null,
  attendeeName: null,
  photos: [],
  removeOriginalsAt: null,
  originalsRemoved: false,
  emailsStopped: false,
  uploadsOpen: false,
  uploadsMessage: null,
  uploadsLeft: 0,
  eventId: null,
  sharedGalleryPath: null,
  sharedGalleryMessage: null,
};

/** Whether uploads are closed on the event row. */
function closedOn(ev: Record<string, AttributeValue> | undefined): boolean {
  return ev?.boothUploadsClosed?.BOOL === true;
}

/**
 * A scanned guest adding their own photo from the gallery page. The key is
 * the whole authorization, as for the gallery. The page has already shrunk
 * the photo (which also drops its location data). It goes to the host's
 * approval queue as one of this person's photos, never straight out.
 */
async function guestUpload(key: string, image: string): Promise<{ ok: boolean; message: string }> {
  const notFound = { ok: false, message: 'This link is not valid. Check the email it came in.' };
  if (!isGalleryKey(key)) return notFound;
  const attendee = await attendeeByKey(key);
  const attendeeId = attendee?.id?.S;
  const eventId = attendee?.eventId?.S;
  if (!attendee || !attendeeId || !eventId) return notFound;
  const ev = await dynamo.send(
    new GetItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      ProjectionExpression: 'id, #owner, boothMode, takenDownAt, boothUploadsClosed, boothStartedAt',
      ExpressionAttributeNames: { '#owner': 'owner' },
    }),
  );
  if (!ev.Item || ev.Item.boothMode?.BOOL !== true || ev.Item.takenDownAt?.S || !ev.Item.owner?.S) return notFound;
  const count = Number(attendee.guestUploadCount?.N ?? 0);
  const b64 = String(image ?? '').replace(/^data:image\/jpeg;base64,/, '');
  const bytes = /^[A-Za-z0-9+/=]+$/.test(b64) && b64.length < 1_000_000 ? Buffer.from(b64, 'base64') : null;
  const refusal = guestUploadRefusal({
    sessionAt: attendee.boothSessionAt?.S ?? null,
    eventStarted: Boolean(ev.Item.boothStartedAt?.S),
    uploadsClosed: closedOn(ev.Item),
    count,
    bytes,
  });
  if (refusal || !bytes) return { ok: false, message: GUEST_UPLOAD_MESSAGES[refusal ?? 'bad-file'] };

  // Count first, conditionally, so two quick uploads cannot pass the limit.
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendeeId } },
        UpdateExpression: 'SET guestUploadCount = if_not_exists(guestUploadCount, :zero) + :one',
        ConditionExpression: 'attribute_not_exists(guestUploadCount) OR guestUploadCount < :max',
        ExpressionAttributeValues: { ':zero': { N: '0' }, ':one': { N: '1' }, ':max': { N: String(MAX_GUEST_UPLOADS) } },
      }),
    );
  } catch {
    return { ok: false, message: GUEST_UPLOAD_MESSAGES.limit };
  }

  const uploadId = randomUUID();
  const objectKey = `pro/${eventId}/guest/${uploadId}.jpg`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, Body: bytes, ContentType: 'image/jpeg' }));
  const now = new Date().toISOString();
  const name = attendee.name?.S ?? 'Guest';
  const catId = attendee.boothSessionCategoryId?.S;
  const catName = attendee.boothSessionCategoryName?.S;
  await dynamo.send(
    new PutItemCommand({
      TableName: PHOTO_TABLE,
      Item: {
        id: { S: uploadId },
        __typename: { S: 'Photo' },
        eventId: { S: eventId },
        s3Key: { S: objectKey },
        previewObjectKey: { S: objectKey },
        thumbnailObjectKey: { S: objectKey },
        originalObjectKey: { S: objectKey },
        storageProvider: { S: 's3' },
        sourceType: { S: 'guest' },
        publishStatus: { S: 'awaiting_review' },
        downloadAllowed: { BOOL: true },
        previewOnly: { BOOL: false },
        watermarkEnabled: { BOOL: false },
        // The host's photo to approve, like their own booth shots.
        photographerId: { S: ev.Item.owner.S },
        boothMatch: { S: 'guest' },
        boothSegment: { S: 'person' },
        boothGuestUpload: { BOOL: true },
        boothAttendeeId: { S: attendeeId },
        boothAttendeeName: { S: name },
        boothAttendeeIds: { L: [{ S: attendeeId }] },
        boothAttendeeNames: { L: [{ S: name }] },
        ...(catId ? { boothCategoryId: { S: catId }, boothCategoryName: { S: catName ?? '' } } : {}),
        capturedAt: { S: now },
        previewFileSize: { N: String(bytes.length) },
        approved: { BOOL: false },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
  return { ok: true, message: 'Thanks! Your photo was sent to the host. It shows here once they approve it.' };
}

/**
 * The guest's own phone camera opened their booth link
 * (https://www.sharepix.net/b/<eventId>/<code>): the private page key for it.
 *
 * - An online sign-up's token finds their row directly.
 * - An offline kiosk code is opened with the private key, and only gives a
 *   page once the photographer has photographed THAT code (its person id is
 *   recorded on the row). Anyone can seal a made-up email with the public key,
 *   so the contact alone must never unlock someone's photos.
 * The same answer for every failure, so codes cannot be probed.
 */
async function guestLink(code: string): Promise<{ ok: boolean; message: string; key: string | null }> {
  const invalid = { ok: false, message: 'This code isn’t valid for any event. Ask the host for a new one.', key: null };
  const fail = {
    ok: false,
    message: 'This code is not ready yet. Your page opens once the photographer has taken a photo of your code. Try again later.',
    key: null,
  };
  const link = readBoothLink(code);
  if (!link) return invalid;
  if (!ATTENDEE_TABLE) return fail;
  const ev = await dynamo
    .send(
      new GetItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: link.eventId } },
        ProjectionExpression: 'id, boothMode, takenDownAt',
      }),
    )
    .catch(() => null);
  if (!ev) return fail;
  if (!ev.Item || ev.Item.boothMode?.BOOL !== true || ev.Item.takenDownAt?.S) return invalid;

  let attendee: Record<string, AttributeValue> | null = null;
  if (link.payload.startsWith('sharepix-booth:')) {
    const token = link.payload.slice('sharepix-booth:'.length);
    const found = await dynamo
      .send(
        new QueryCommand({
          TableName: ATTENDEE_TABLE,
          IndexName: ATTENDEES_BY_TOKEN,
          KeyConditionExpression: '#token = :token',
          ExpressionAttributeNames: { '#token': 'token' },
          ExpressionAttributeValues: { ':token': { S: token } },
          Limit: 2,
        }),
      )
      .catch(() => null);
    attendee = found?.Items?.[0] ?? null;
  } else if (BOOTH_PRIVATE_KEY) {
    const opened = await openContact({ payload: link.payload, eventId: link.eventId, privateKeyPkcs8: BOOTH_PRIVATE_KEY });
    if (opened) {
      const id = offlineId(link.eventId, opened.contact.email ?? opened.contact.phone ?? '');
      const row = await dynamo
        .send(new GetItemCommand({ TableName: ATTENDEE_TABLE, Key: { id: { S: id } }, ConsistentRead: true }))
        .catch(() => null);
      const item = row?.Item;
      const ids = new Set([item?.offlinePersonId?.S, ...(item?.offlinePersonIds?.SS ?? [])]);
      if (item && ids.has(opened.personId)) attendee = item;
    }
  }
  if (!attendee || attendee.eventId?.S !== link.eventId) return fail;
  const key = attendee.galleryKey?.S;
  if (!key) return fail;
  return { ok: true, message: '', key };
}

/** Same derivation as process-pro-photo/boothOffline.ts offlineAttendeeId. */
function offlineId(eventId: string, contactKey: string): string {
  return `${eventId}#${createHash('sha256').update(contactKey).digest('hex').slice(0, 32)}`;
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
  return found.Items?.[0] ?? null;
}

/**
 * "Stop these emails", from the link in every booth email. The key is the
 * whole authorization, as for the gallery. The gallery itself stays open.
 */
async function stopEmails(key: string): Promise<{ ok: boolean; message: string }> {
  const notFound = { ok: false, message: 'This link is not valid. Check the email it came in.' };
  if (!isGalleryKey(key)) return notFound;
  const attendee = await attendeeByKey(key);
  const attendeeId = attendee?.id?.S;
  if (!attendeeId) return notFound;
  await dynamo.send(
    new UpdateItemCommand({
      TableName: ATTENDEE_TABLE,
      Key: { id: { S: attendeeId } },
      UpdateExpression: 'SET emailsStopped = :true, updatedAt = :now',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeValues: { ':true': { BOOL: true }, ':now': { S: new Date().toISOString() } },
    }),
  );
  return { ok: true, message: 'Done. You will not get any more emails about these photos.' };
}

function recipientsOf(item: Record<string, AttributeValue>): string[] {
  const list = item.boothAttendeeIds?.L?.map((v) => v.S ?? '').filter(Boolean) ?? [];
  if (list.length > 0) return list;
  return item.boothAttendeeId?.S ? [item.boothAttendeeId.S] : [];
}

function sign(key: string, filename?: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
    }),
    { expiresIn: LINK_TTL_SECONDS },
  );
}

/**
 * One attendee's gallery, by the secret key in their email.
 *
 * Public, because the attendee has no account; the 192-bit key is the whole
 * authorization, and a wrong key gets the same answer as a missing one. Only
 * photos assigned to this person AND approved by the photographer are
 * returned, with links signed here — the pro/ prefix has no browser access
 * rule, so these links are the only way in.
 */
export const handler = async (event: {
  arguments: { key?: string | null; image?: string | null; code?: string | null };
  info?: { fieldName?: string };
  fieldName?: string;
}) => {
  const key = String(event.arguments.key ?? '').trim();
  // Amplify Gen2 passes the field at the top level; `info` is the AppSync shape.
  const field = event.info?.fieldName ?? event.fieldName ?? '';
  if (field === 'boothStopEmails') return stopEmails(key);
  if (field === 'boothGuestLink') return guestLink(String(event.arguments.code ?? ''));
  if (field === 'boothGuestUpload') return guestUpload(key, String(event.arguments.image ?? ''));
  if (!isGalleryKey(key)) return NOT_FOUND;

  const attendee = await attendeeByKey(key);
  const attendeeId = attendee?.id?.S;
  const eventId = attendee?.eventId?.S;
  if (!attendeeId || !eventId) return NOT_FOUND;

  const ev = await dynamo.send(
    new GetItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      ProjectionExpression: 'id, #name, #date, createdAt, boothMode, takenDownAt, boothOriginalsRemovedAt, boothUploadsClosed, boothStartedAt, galleryAudience',
      ExpressionAttributeNames: { '#name': 'name', '#date': 'date' },
    }),
  );
  if (!ev.Item || ev.Item.boothMode?.BOOL !== true || ev.Item.takenDownAt?.S) return NOT_FOUND;
  const eventName = ev.Item.name?.S ?? 'Your photos';
  const removedAt = ev.Item.boothOriginalsRemovedAt?.S ?? null;
  const removeOriginalsAt =
    removedAt ?? originalsRemovedAt({ date: ev.Item.date?.S ?? null, createdAt: ev.Item.createdAt?.S ?? null });

  const mine: Record<string, AttributeValue>[] = [];
  let start: Record<string, AttributeValue> | undefined;
  for (let page = 0; page < 50 && mine.length < MAX_GALLERY_PHOTOS; page += 1) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: PHOTO_TABLE,
        IndexName: PHOTOS_BY_EVENT,
        KeyConditionExpression: 'eventId = :event',
        FilterExpression: 'attribute_exists(boothMatch) AND publishStatus = :approved',
        ExpressionAttributeValues: { ':event': { S: eventId }, ':approved': { S: 'approved' } },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of res.Items ?? []) {
      if (inGallery({ recipients: recipientsOf(item), publishStatus: item.publishStatus?.S ?? null }, attendeeId)) {
        mine.push(item);
      }
    }
    start = res.LastEvaluatedKey;
    if (!start) break;
  }
  mine.sort((a, b) => (a.capturedAt?.S ?? a.createdAt?.S ?? '').localeCompare(b.capturedAt?.S ?? b.createdAt?.S ?? ''));

  const photos = await Promise.all(
    mine.slice(0, MAX_GALLERY_PHOTOS).map(async (item, index) => {
      const preview = item.previewObjectKey?.S ?? item.s3Key?.S ?? '';
      const original = item.originalObjectKey?.S ?? '';
      // The content type names the file correctly (a HEIC stays a HEIC).
      const head = original
        ? await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: original })).catch(() => null)
        : null;
      return {
        id: item.id?.S ?? '',
        previewUrl: preview ? await sign(preview) : null,
        // No original (it failed to keep, or was cleaned up): the preview is
        // all there is, and the page says so rather than offering nothing.
        downloadUrl: head
          ? await sign(original, downloadName(eventName, index, head.ContentType ?? null))
          : null,
        capturedAt: item.capturedAt?.S ?? null,
      };
    }),
  );

  return {
    ok: true,
    message: photos.length === 0 ? 'No photos yet. You will get an email when they are ready.' : '',
    eventName,
    attendeeName: attendee.name?.S ?? null,
    photos,
    removeOriginalsAt,
    originalsRemoved: Boolean(removedAt),
    emailsStopped: attendee.emailsStopped?.BOOL === true,
    ...uploadState(attendee, ev.Item),
    eventId,
    ...sharedGalleryFor({ eventId, audience: ev.Item.galleryAudience?.S ?? null, takenDown: false }),
  };
};

function uploadState(attendee: Record<string, AttributeValue>, ev: Record<string, AttributeValue>) {
  const count = Number(attendee.guestUploadCount?.N ?? 0);
  const refusal = guestUploadRefusal({
    sessionAt: attendee.boothSessionAt?.S ?? null,
    eventStarted: Boolean(ev.boothStartedAt?.S),
    uploadsClosed: closedOn(ev),
    count,
    bytes: Buffer.from([0xff, 0xd8, 0xff, ...new Array(200).fill(0)]),
  });
  return {
    uploadsOpen: refusal === null,
    uploadsMessage: refusal ? GUEST_UPLOAD_MESSAGES[refusal] : null,
    uploadsLeft: Math.max(0, MAX_GUEST_UPLOADS - count),
  };
}
