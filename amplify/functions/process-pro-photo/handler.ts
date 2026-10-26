import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Jimp } from 'jimp';
import type { Schema } from '../../data/resource';
import { connectionId, mayRunOwnBooth, mayUploadToEvent } from './photographerAccess';
import { exifCaptureTime } from './captureTime';
import { isHeic, isJpeg, stripHeicGps, stripJpegMetadata } from './exif';
import { boothScanKey, photoInstant } from './boothMatch';
import { contactLabel, openContact, type BoothContact } from './boothSeal';
import { DECODE_LONG_EDGE, findDividerCode } from './boothDivider';
import {
  NOBODY,
  belongsToDivider,
  cameraAtISO,
  cameraScanKey,
  dividerScanId,
  offlineAttendeeId,
} from './boothOffline';
import {
  destinationOfScan,
  isControlPayload,
  markerLabel,
  markerToScanId,
  parseCategories,
  photoFieldsFor,
  readControlCode,
  stateAfterScan,
  step,
  uploadsAfterScan,
  START_STATE,
  type Destination,
  type Marker,
} from './boothControl';
import { createHash, randomBytes } from 'node:crypto';
import {
  defaultsFor,
  previewLongEdge,
  professionalKeys,
  THUMBNAIL_LONG_EDGE,
} from './professionalMedia';
import {
  PREVIEW_QUALITY,
  THUMBNAIL_QUALITY,
  canProcess,
  discardDecision,
  scaleToLongEdge,
} from './proProcessing';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const PROFILE_TABLE = process.env.PROFILE_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME ?? '';
const SCAN_TABLE = process.env.BOOTH_SCAN_TABLE_NAME ?? '';
const SCANS_BY_KEY = 'boothScansByScanKey';
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME ?? '';
const BOOTH_PRIVATE_KEY = process.env.BOOTH_PRIVATE_KEY ?? '';
const PHOTOS_BY_EVENT = 'photosByEventId';
/** Same ceiling as online sign-up (booth-signup/signup.ts). */
const MAX_ATTENDEES_PER_EVENT = 10000;

/** Whether this event is in booth mode (docs/booth-mode.md), and its owner. */
async function boothEvent(
  eventId: string,
): Promise<{ booth: boolean; owner: string; categories: { id: string; name: string }[]; closedBy: 'host' | 'stop' | null }> {
  if (!EVENT_TABLE) return { booth: false, owner: '', categories: [], closedBy: null };
  const found = await dynamo
    .send(
      new GetItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        ProjectionExpression: 'id, boothMode, #owner, boothCategories, boothUploadsClosed, boothUploadsClosedBy',
        ExpressionAttributeNames: { '#owner': 'owner' },
      }),
    )
    .catch(() => null);
  const item = found?.Item;
  const by = item?.boothUploadsClosedBy?.S;
  return {
    booth: item?.boothMode?.BOOL === true,
    owner: item?.owner?.S ?? '',
    categories: parseCategories(item?.boothCategories?.S ?? null),
    closedBy: item?.boothUploadsClosed?.BOOL === true ? (by === 'stop' ? 'stop' : 'host') : null,
  };
}

/** The latest QR divider at or before this camera time, if any. */
async function latestCameraScan(
  eventId: string,
  sub: string,
  cameraAt: string,
): Promise<{ attendeeId: string; name: string; categoryId: string | null; categoryName: string | null } | null> {
  if (!SCAN_TABLE) return null;
  const res = await dynamo
    .send(
      new QueryCommand({
        TableName: SCAN_TABLE,
        IndexName: SCANS_BY_KEY,
        KeyConditionExpression: 'scanKey = :key AND scannedAt <= :at',
        ExpressionAttributeValues: {
          ':key': { S: cameraScanKey(eventId, sub) },
          ':at': { S: cameraAt },
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
    )
    .catch(() => null);
  const item = res?.Items?.[0];
  if (!item?.attendeeId?.S) return null;
  return {
    attendeeId: item.attendeeId.S,
    name: item.attendeeName?.S ?? 'Guest',
    categoryId: item.categoryId?.S ?? null,
    categoryName: item.categoryName?.S ?? null,
  };
}

/** DynamoDB fields for a photo going to a destination (boothControl.photoFieldsFor). */
function destinationAttributes(dest: Destination): Record<string, AttributeValue> {
  const f = photoFieldsFor(dest);
  return {
    boothMatch: { S: f.boothMatch },
    boothSegment: { S: f.boothSegment },
    boothAttendeeIds: { L: f.attendeeIds.map((S) => ({ S })) },
    boothAttendeeNames: { L: f.attendeeNames.map((S) => ({ S })) },
    ...(f.attendeeIds[0] ? { boothAttendeeId: { S: f.attendeeIds[0] }, boothAttendeeName: { S: f.attendeeNames[0] } } : {}),
    ...(f.categoryId ? { boothCategoryId: { S: f.categoryId } } : {}),
    ...(f.categoryName ? { boothCategoryName: { S: f.categoryName } } : {}),
  };
}

/**
 * A person was scanned: from now on they may add their own photos from their
 * gallery page (into the category that is running), until uploads close.
 */
async function openGuestSession(attendeeId: string, dest: Destination): Promise<void> {
  if (!ATTENDEE_TABLE || dest.to !== 'person') return;
  const now = new Date().toISOString();
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: ATTENDEE_TABLE,
        Key: { id: { S: attendeeId } },
        UpdateExpression: dest.categoryId
          ? 'SET boothSessionAt = :now, boothSessionCategoryId = :cid, boothSessionCategoryName = :cname'
          : 'SET boothSessionAt = :now REMOVE boothSessionCategoryId, boothSessionCategoryName',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: {
          ':now': { S: now },
          ...(dest.categoryId ? { ':cid': { S: dest.categoryId }, ':cname': { S: dest.categoryName ?? '' } } : {}),
        },
      }),
    )
    .catch(() => undefined);
}

/** A stop code closes guest uploads; a start code reopens them if a stop closed them. */
async function applyUploadsAfterScan(eventId: string, closedBy: 'host' | 'stop' | null, dest: Destination): Promise<void> {
  if (!EVENT_TABLE) return;
  const before = { closed: closedBy !== null, by: closedBy };
  const after = uploadsAfterScan(before, dest);
  if (after.closed === before.closed && after.by === before.by) return;
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: after.closed
          ? 'SET boothUploadsClosed = :t, boothUploadsClosedBy = :by'
          : 'SET boothUploadsClosed = :f REMOVE boothUploadsClosedBy',
        // Never undo a host's close.
        ConditionExpression: 'attribute_not_exists(boothUploadsClosedBy) OR boothUploadsClosedBy <> :host',
        ExpressionAttributeValues: {
          ':host': { S: 'host' },
          ...(after.closed ? { ':t': { BOOL: true }, ':by': { S: 'stop' } } : { ':f': { BOOL: false } }),
        },
      }),
    )
    .catch(() => undefined);
}

/** The next QR divider strictly after this camera time, if any. */
async function nextCameraScanAt(eventId: string, sub: string, cameraAt: string): Promise<string | null> {
  if (!SCAN_TABLE) return null;
  const res = await dynamo
    .send(
      new QueryCommand({
        TableName: SCAN_TABLE,
        IndexName: SCANS_BY_KEY,
        KeyConditionExpression: 'scanKey = :key AND scannedAt > :at',
        ExpressionAttributeValues: {
          ':key': { S: cameraScanKey(eventId, sub) },
          ':at': { S: cameraAt },
        },
        ScanIndexForward: true,
        Limit: 1,
      }),
    )
    .catch(() => null);
  return res?.Items?.[0]?.scannedAt?.S ?? null;
}

/**
 * Create (or find) the attendee a decrypted offline code describes. The id is
 * derived from the email (or phone), the same as online sign-up, so one
 * person is one row however many codes they made. The host never sees the
 * contact: the row's name is a masked label, and email/phone are admin-only
 * fields in the schema.
 */
async function upsertOfflineAttendee(
  eventId: string,
  owner: string,
  personId: string,
  contact: BoothContact,
): Promise<{ id: string; name: string } | null> {
  if (!ATTENDEE_TABLE) return null;
  const id = offlineAttendeeId(eventId, contact);
  const label = contactLabel(contact);
  const now = new Date().toISOString();
  const existing = await dynamo
    .send(new GetItemCommand({ TableName: ATTENDEE_TABLE, Key: { id: { S: id } }, ConsistentRead: true }))
    .catch(() => null);
  if (existing?.Item) {
    // Fill in what this code adds (a phone, texting consent); never replace.
    const sets = ['galleryKey = if_not_exists(galleryKey, :key)', 'contactLabel = if_not_exists(contactLabel, :label)'];
    const values: Record<string, AttributeValue> = {
      ':key': { S: randomBytes(24).toString('base64url') },
      ':label': { S: label },
    };
    if (contact.phone) {
      sets.push('phone = if_not_exists(phone, :phone)');
      values[':phone'] = { S: contact.phone };
      if (contact.smsConsent) {
        sets.push('smsConsentAt = if_not_exists(smsConsentAt, :now)');
        values[':now'] = { S: now };
      }
    }
    if (contact.email) {
      sets.push('email = if_not_exists(email, :email)');
      values[':email'] = { S: contact.email };
    }
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: ATTENDEE_TABLE,
          Key: { id: { S: id } },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeValues: values,
        }),
      )
      .catch(() => undefined);
    return { id, name: existing.Item.name?.S ?? label };
  }

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'ADD boothAttendeeCount :one',
        ConditionExpression: 'attribute_not_exists(boothAttendeeCount) OR boothAttendeeCount < :max',
        ExpressionAttributeValues: { ':one': { N: '1' }, ':max': { N: String(MAX_ATTENDEES_PER_EVENT) } },
      }),
    );
  } catch {
    return null;
  }
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: ATTENDEE_TABLE,
        Item: {
          id: { S: id },
          __typename: { S: 'BoothAttendee' },
          eventId: { S: eventId },
          ...(owner ? { eventOwner: { S: owner } } : {}),
          name: { S: label },
          contactLabel: { S: label },
          ...(contact.email ? { email: { S: contact.email } } : {}),
          ...(contact.phone ? { phone: { S: contact.phone } } : {}),
          ...(contact.phone && contact.smsConsent ? { smsConsentAt: { S: now } } : {}),
          token: { S: randomBytes(15).toString('base64url') },
          galleryKey: { S: randomBytes(24).toString('base64url') },
          offlinePersonId: { S: personId },
          signupSource: { S: 'offline-qr' },
          consentedAt: { S: now },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (err) {
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: 'ADD boothAttendeeCount :neg',
          ExpressionAttributeValues: { ':neg': { N: '-1' } },
        }),
      )
      .catch(() => undefined);
    if ((err as { name?: string })?.name !== 'ConditionalCheckFailedException') return null;
  }
  return { id, name: label };
}

/**
 * A divider landed: re-point this photographer's photos between it and the
 * next divider (camera time) at its person. Photos uploaded before their
 * divider was processed are fixed here, so upload order never matters.
 * Hand-fixed photos and other dividers are left alone.
 */
async function rematchAfterDivider(
  eventId: string,
  sub: string,
  dividerAt: string,
  dest: Destination,
): Promise<void> {
  const fields = destinationAttributes(dest);
  const hasPerson = Boolean(fields.boothAttendeeId);
  const removes = [
    ...(hasPerson ? [] : ['boothAttendeeId', 'boothAttendeeName']),
    ...(fields.boothCategoryId ? [] : ['boothCategoryId', 'boothCategoryName']),
  ];
  const nextAt = await nextCameraScanAt(eventId, sub, dividerAt);
  let start: Record<string, AttributeValue> | undefined;
  for (let page = 0; page < 50; page += 1) {
    const res = await dynamo
      .send(
        new QueryCommand({
          TableName: PHOTO_TABLE,
          IndexName: PHOTOS_BY_EVENT,
          KeyConditionExpression: 'eventId = :event',
          FilterExpression: 'photographerId = :sub AND cameraAt >= :at',
          ExpressionAttributeValues: { ':event': { S: eventId }, ':sub': { S: sub }, ':at': { S: dividerAt } },
          ProjectionExpression: 'id, cameraAt, boothMatch',
          ExclusiveStartKey: start,
        }),
      )
      .catch(() => null);
    if (!res) return;
    for (const item of res.Items ?? []) {
      const at = item.cameraAt?.S ?? '';
      const match = item.boothMatch?.S ?? '';
      if (!at || match === 'manual' || match === 'divider') continue;
      if (!belongsToDivider(at, dividerAt, nextAt)) continue;
      const now = new Date().toISOString();
      await dynamo
        .send(
          new UpdateItemCommand({
            TableName: PHOTO_TABLE,
            Key: { id: { S: item.id!.S! } },
            UpdateExpression:
              'SET boothAttendeeIds = :ids, boothAttendeeNames = :names, boothMatch = :match, boothSegment = :segment, updatedAt = :now' +
              (hasPerson ? ', boothAttendeeId = :id, boothAttendeeName = :name' : '') +
              (fields.boothCategoryId ? ', boothCategoryId = :cid, boothCategoryName = :cname' : '') +
              (removes.length ? ` REMOVE ${removes.join(', ')}` : ''),
            // Never over a hand fix that landed meanwhile.
            ConditionExpression: 'boothMatch <> :manual AND boothMatch <> :divider',
            ExpressionAttributeValues: {
              ':ids': fields.boothAttendeeIds,
              ':names': fields.boothAttendeeNames,
              ':match': fields.boothMatch,
              ':segment': fields.boothSegment,
              ':now': { S: now },
              ':manual': { S: 'manual' },
              ':divider': { S: 'divider' },
              ...(hasPerson ? { ':id': fields.boothAttendeeId, ':name': fields.boothAttendeeName } : {}),
              ...(fields.boothCategoryId ? { ':cid': fields.boothCategoryId, ':cname': fields.boothCategoryName ?? { S: '' } } : {}),
            },
          }),
        )
        .catch(() => undefined);
    }
    start = res.LastEvaluatedKey;
    if (!start) break;
  }
}

/** Fingerprint for logs: never the payload, which carries sealed contact details. */
function payloadTag(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 8);
}

/**
 * Who a booth photo belongs to: the latest scan by this photographer at or
 * before the moment it was taken. Never throws — an unmatched photo is still
 * a photo, and the photographer can assign it by hand.
 */
async function boothAssignment(input: {
  eventId: string;
  sub: string;
  source: Buffer;
  offsetMs: number | null;
}): Promise<Record<string, AttributeValue>> {
  const captureText = exifCaptureTime(input.source);
  const { atMs, match } = photoInstant({
    captureText,
    offsetMs: input.offsetMs,
    uploadedAtMs: Date.now(),
  });
  const capturedAt = new Date(atMs).toISOString();
  const latest = SCAN_TABLE
    ? await dynamo
        .send(
          new QueryCommand({
            TableName: SCAN_TABLE,
            IndexName: SCANS_BY_KEY,
            KeyConditionExpression: 'scanKey = :key AND scannedAt <= :at',
            ExpressionAttributeValues: {
              ':key': { S: boothScanKey(input.eventId, input.sub) },
              ':at': { S: capturedAt },
            },
            ScanIndexForward: false,
            Limit: 1,
          }),
        )
        .catch(() => null)
    : null;
  const scan = latest?.Items?.[0];
  if (!scan?.attendeeId?.S) {
    return { boothMatch: { S: 'unassigned' }, capturedAt: { S: capturedAt } };
  }
  // A live scan may be a start or stop code (boothControl.ts) or a person.
  const dest = destinationOfScan({
    attendeeId: scan.attendeeId.S,
    name: scan.attendeeName?.S ?? 'Guest',
    categoryId: scan.categoryId?.S ?? null,
    categoryName: scan.categoryName?.S ?? null,
  });
  const fields = destinationAttributes(dest);
  // A person matched by upload time stays marked "check".
  if (dest.to === 'person') fields.boothMatch = { S: match };
  return { ...fields, capturedAt: { S: capturedAt } };
}

type Handler = Schema['processProPhoto']['functionHandler'];

/** The offline booth code in this photo, if it fills enough of the frame. */
async function dividerPayload(source: Buffer): Promise<string | null> {
  const image = await Jimp.read(source);
  const scale = scaleToLongEdge(image.width, image.height, DECODE_LONG_EDGE);
  if (scale.resized) image.resize({ w: scale.width, h: scale.height });
  const { data, width, height } = image.bitmap;
  return findDividerCode(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height);
}

async function bodyOf(key: string): Promise<Buffer | null> {
  const result = await s3
    .send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    .catch(() => null);
  if (!result?.Body) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Turn one uploaded original into what the gallery serves.
 *
 * ## Idempotent by the row, not by a flag
 *
 * The Photo row's id is the upload id, and it is written with a conditional
 * put. Calling this twice for the same upload writes one row; the second call
 * finds it and returns it. That matters more than it looks: the future Bridge
 * queues uploads offline and retries them, and a retry that produced a second
 * gallery tile would be worse than one that failed.
 *
 * ## The original is deleted last, and only on success
 *
 * See discardDecision. A photographer may have formatted the card already, so
 * a failure that took the original with it would not degrade the photograph —
 * it would destroy it. Every failure path here leaves the original in place to
 * be retried.
 */
export const handler: Handler = async (event) => {
  const sub = event.identity && 'sub' in event.identity ? String(event.identity.sub) : '';
  const eventId = String(event.arguments.eventId ?? '');
  const uploadId = String(event.arguments.uploadId ?? '');
  if (!sub || !eventId || !uploadId) throw new Error('That upload could not be found.');

  // Authorization first, before a single byte is read. Same answer for every
  // way of not being allowed.
  const connectionRow = await dynamo
    .send(
      new GetItemCommand({
        TableName: CONNECTION_TABLE,
        Key: { id: { S: connectionId(eventId, sub) } },
      }),
    )
    .catch(() => null);
  const connection = connectionRow?.Item
    ? {
        eventId: connectionRow.Item.eventId?.S ?? null,
        photographerId: connectionRow.Item.photographerId?.S ?? null,
        status: connectionRow.Item.status?.S ?? null,
      }
    : null;
  // Or the host (or an admin) running their own booth-mode event: their
  // uploads go through the same QR-divider matching as a photographer's.
  if (!mayUploadToEvent(connection, eventId, sub)) {
    const groups = (event.identity as { groups?: string[] | null } | null)?.groups ?? null;
    const ev = await boothEvent(eventId);
    if (!mayRunOwnBooth({ owner: ev.owner, boothMode: ev.booth }, sub, groups)) {
      throw new Error('That upload could not be found.');
    }
  }

  // Already done? Return it rather than doing it again.
  const existing = await dynamo
    .send(new GetItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: uploadId } } }))
    .catch(() => null);
  if (existing?.Item) {
    return {
      uploadId,
      publishStatus: existing.Item.publishStatus?.S ?? 'received',
      message: 'That photo was already processed.',
    };
  }

  const keys = professionalKeys(eventId, uploadId);

  const head = await s3
    .send(new HeadObjectCommand({ Bucket: BUCKET, Key: keys.original }))
    .catch(() => null);
  if (!head) throw new Error('That upload could not be found.');

  const gate = canProcess({
    bytes: head.ContentLength ?? 0,
    mime: head.ContentType ?? null,
  });
  if (!gate.ok) {
    // Refused, so nothing was written and nothing should linger. This is the
    // one delete that happens without derivatives, and it is safe because we
    // never made anything from it and the photographer is being told now.
    await s3
      .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: keys.original }))
      .catch(() => null);
    throw new Error(gate.message);
  }

  const profile = await dynamo
    .send(new GetItemCommand({ TableName: PROFILE_TABLE, Key: { id: { S: sub } } }))
    .catch(() => null);
  const p = profile?.Item;
  // A booth event delivers the original itself, so it is always kept there.
  const boothRow = await boothEvent(eventId);
  const booth = boothRow.booth;
  const keepOriginal = booth || p?.keepOriginals?.BOOL === true;
  const longEdge = previewLongEdge(
    p?.defaultPreviewResolution?.N ? Number(p.defaultPreviewResolution.N) : null,
  );

  const source = await bodyOf(keys.original);
  if (!source) throw new Error('That upload could not be read.');

  const offsetN = connectionRow?.Item?.boothClockOffsetMs?.N;
  let boothFields: Record<string, AttributeValue> = booth
    ? await boothAssignment({
        eventId,
        sub,
        source,
        offsetMs: offsetN !== undefined ? Number(offsetN) : null,
      })
    : {};

  // Offline booth (docs/booth-mode.md): the camera's own clock orders photos
  // against QR dividers shot on the same camera.
  const cameraAt = booth ? cameraAtISO(exifCaptureTime(source)) : null;
  let divider: { marker: Marker; dest: Destination } | null = null;
  if (booth && BOOTH_PRIVATE_KEY) {
    const payload = await dividerPayload(source).catch(() => null);
    if (payload) {
      let marker: Marker = { kind: 'unreadable' };
      if (isControlPayload(payload)) {
        // A start or stop code from the Booth tab (boothControl.ts).
        const code = readControlCode(BOOTH_PRIVATE_KEY, eventId, payload);
        if (code?.kind === 'e') marker = { kind: 'event' };
        else if (code?.kind === 's') marker = { kind: 'stop' };
        else if (code?.kind === 'c') {
          const cat = boothRow.categories.find((c) => c.id === code.id);
          // A deleted category's code goes nowhere rather than guessing.
          if (cat) marker = { kind: 'category', categoryId: cat.id, categoryName: cat.name };
        }
      } else {
        const opened = await openContact({ payload, eventId, privateKeyPkcs8: BOOTH_PRIVATE_KEY });
        const attendee = opened
          ? await upsertOfflineAttendee(eventId, boothRow.owner, opened.personId, opened.contact)
          : null;
        if (attendee) marker = { kind: 'person', attendeeId: attendee.id, name: attendee.name };
      }
      if (marker.kind === 'unreadable') {
        console.warn('Booth code did not open for this event', { uploadId, tag: payloadTag(payload) });
      }
      // A person scanned while a category runs is labelled with it.
      const prev = cameraAt ? await latestCameraScan(eventId, sub, cameraAt) : null;
      const before = prev ? stateAfterScan(destinationOfScan(prev), START_STATE) : START_STATE;
      const { dest } = step(before, marker);
      divider = { marker, dest };
      boothFields = {
        boothMatch: { S: 'divider' },
        boothDivider: { BOOL: true },
        boothAttendeeIds: { L: [] },
        boothAttendeeNames: { L: [] },
        ...(marker.kind !== 'unreadable' ? { boothDividerFor: { S: markerLabel(marker) } } : {}),
        ...(cameraAt ? { cameraAt: { S: cameraAt } } : { boothDividerNoTime: { BOOL: true } }),
      };
    }
  }
  if (booth && cameraAt && !divider) {
    boothFields.cameraAt = { S: cameraAt };
    const fromDivider = await latestCameraScan(eventId, sub, cameraAt);
    if (fromDivider) {
      const keepCapture = boothFields.capturedAt;
      boothFields = { ...destinationAttributes(destinationOfScan(fromDivider)), cameraAt: { S: cameraAt } };
      if (keepCapture) boothFields.capturedAt = keepCapture;
    }
  }
  if (divider && cameraAt && SCAN_TABLE) {
    await dynamo
      .send(
        new PutItemCommand({
          TableName: SCAN_TABLE,
          Item: {
            id: { S: dividerScanId(eventId, sub, uploadId) },
            __typename: { S: 'BoothScan' },
            scanKey: { S: cameraScanKey(eventId, sub) },
            eventId: { S: eventId },
            photographerId: { S: sub },
            attendeeId: { S: markerToScanId(divider.marker) ?? NOBODY },
            attendeeName: { S: markerLabel(divider.marker) },
            ...(divider.dest.to === 'person' && divider.dest.categoryId
              ? { categoryId: { S: divider.dest.categoryId }, categoryName: { S: divider.dest.categoryName ?? '' } }
              : divider.dest.to === 'category'
                ? { categoryId: { S: divider.dest.categoryId }, categoryName: { S: divider.dest.categoryName } }
                : {}),
            scannedAt: { S: cameraAt },
            createdAt: { S: new Date().toISOString() },
            updatedAt: { S: new Date().toISOString() },
          },
        }),
      )
      .catch((error) => console.error('Could not record a booth divider', { uploadId, error: (error as Error).message }));
  }

  let previewWritten = false;
  let thumbnailWritten = false;
  let previewBytes = 0;

  try {
    const image = await Jimp.read(source);
    const width = image.width;
    const height = image.height;

    const preview = scaleToLongEdge(width, height, longEdge);
    if (preview.resized) image.resize({ w: preview.width, h: preview.height });
    // SharePix never watermarks photos (docs/decisions.md): the preview is the
    // photographer's image, reduced, and nothing more.
    const previewBody = await image.getBuffer('image/jpeg', { quality: PREVIEW_QUALITY });
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: keys.preview,
        Body: previewBody,
        ContentType: 'image/jpeg',
      }),
    );
    previewWritten = true;
    previewBytes = previewBody.length;

    const thumb = scaleToLongEdge(preview.width, preview.height, THUMBNAIL_LONG_EDGE);
    if (thumb.resized) image.resize({ w: thumb.width, h: thumb.height });
    const thumbBody = await image.getBuffer('image/jpeg', { quality: THUMBNAIL_QUALITY });
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: keys.thumbnail,
        Body: thumbBody,
        ContentType: 'image/jpeg',
      }),
    );
    thumbnailWritten = true;
  } catch (error) {
    // The original stays. It is the only thing left to retry from.
    throw new Error(
      `That photo could not be processed: ${(error as Error).message}. Your original is safe — try again.`,
    );
  }

  const defaults = defaultsFor(longEdge);
  const now = new Date().toISOString();

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: PHOTO_TABLE,
        Item: {
          id: { S: uploadId },
          __typename: { S: 'Photo' },
          eventId: { S: eventId },
          // s3Key stays the addressing field the rest of the system reads.
          s3Key: { S: keys.preview },
          previewObjectKey: { S: keys.preview },
          thumbnailObjectKey: { S: keys.thumbnail },
          ...(keepOriginal ? { originalObjectKey: { S: keys.original } } : {}),
          storageProvider: { S: 's3' },
          sourceType: { S: defaults.sourceType },
          publishStatus: { S: 'awaiting_review' },
          downloadAllowed: { BOOL: defaults.downloadAllowed },
          previewOnly: { BOOL: defaults.previewOnly },
          reducedResolutionEnabled: { BOOL: defaults.reducedResolutionEnabled },
          previewResolution: { N: String(defaults.previewResolution) },
          watermarkEnabled: { BOOL: false },
          photographerId: { S: sub },
          ...(p?.businessName?.S ? { photographerName: { S: p.businessName.S } } : {}),
          ...(p?.website?.S ? { photographerWebsite: { S: p.website.S } } : {}),
          ...(p?.purchaseGalleryUrl?.S ? { purchaseUrl: { S: p.purchaseGalleryUrl.S } } : {}),
          ...(p?.contactUrl?.S ? { contactUrl: { S: p.contactUrl.S } } : {}),
          previewFileSize: { N: String(previewBytes) },
          ...boothFields,
          approved: { BOOL: false },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        // A retry that raced the first call writes nothing rather than a
        // second tile for one photograph.
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    return { uploadId, publishStatus: 'awaiting_review', message: 'That photo was already processed.' };
  }

  // A booth original is downloaded by the person in it (docs/booth-mode.md),
  // so its location and camera metadata go before anyone can fetch it. The
  // capture time was already read for matching. Orientation is kept. A file
  // that does not parse is left as it is rather than risked.
  if (booth) {
    const cleaned = isJpeg(source)
      ? stripJpegMetadata(source)
      : isHeic(source)
        ? stripHeicGps(source)
        : null;
    if (cleaned) {
      await s3
        .send(
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: keys.original,
            Body: cleaned,
            ContentType: head.ContentType ?? 'image/jpeg',
          }),
        )
        .catch((error) => {
          console.error('Booth original could not be cleaned', { uploadId, error: (error as Error).message });
        });
    }
  }

  if (divider && cameraAt) {
    await rematchAfterDivider(eventId, sub, cameraAt, divider.dest).catch(() => undefined);
  }
  if (divider) {
    if (divider.dest.to === 'person') await openGuestSession(divider.dest.attendeeId, divider.dest);
    await applyUploadsAfterScan(eventId, boothRow.closedBy, divider.dest);
  }

  const discard = discardDecision({ previewWritten, thumbnailWritten, keepOriginal });
  if (discard.discard) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: BUCKET, Key: keys.original }))
      // A delete that fails leaves a file costing storage, which is a bill
      // rather than an incident. Never fail the upload over it.
      .catch(() => null);
  }

  return {
    uploadId,
    publishStatus: 'awaiting_review',
    message: 'Ready for review.',
  };
};
