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
import { connectionId, mayUploadToEvent } from './photographerAccess';
import { exifCaptureTime } from './captureTime';
import { applyWatermark } from './stamp';
import { cleanPreviewKey, watermarkSpec } from './watermark';
import { isHeic, isJpeg, stripHeicGps, stripJpegMetadata } from './exif';
import { boothScanKey, photoInstant } from './boothMatch';
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

/** Whether this event is in booth mode (docs/booth-mode.md). */
async function isBoothEvent(eventId: string): Promise<boolean> {
  if (!EVENT_TABLE) return false;
  const found = await dynamo
    .send(
      new GetItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        ProjectionExpression: 'id, boothMode',
      }),
    )
    .catch(() => null);
  return found?.Item?.boothMode?.BOOL === true;
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
  return {
    boothAttendeeId: { S: scan.attendeeId.S },
    ...(scan.attendeeName?.S ? { boothAttendeeName: { S: scan.attendeeName.S } } : {}),
    // The recipient list the fix-up screen edits; one person to start.
    boothAttendeeIds: { L: [{ S: scan.attendeeId.S }] },
    boothAttendeeNames: { L: [{ S: scan.attendeeName?.S ?? 'Guest' }] },
    boothMatch: { S: match },
    capturedAt: { S: capturedAt },
  };
}

type Handler = Schema['processProPhoto']['functionHandler'];

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
  if (!mayUploadToEvent(connection, eventId, sub)) {
    throw new Error('That upload could not be found.');
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
  const booth = await isBoothEvent(eventId);
  const keepOriginal = booth || p?.keepOriginals?.BOOL === true;
  const watermark = watermarkSpec({
    watermarkEnabled: p?.watermarkEnabled?.BOOL ?? false,
    watermarkText: p?.watermarkText?.S ?? null,
    businessName: p?.businessName?.S ?? null,
    watermarkStyle: p?.watermarkStyle?.S ?? null,
    watermarkLogo: p?.watermarkLogo?.S ?? null,
    watermarkPosition: p?.watermarkPosition?.S ?? null,
    watermarkOpacity: p?.watermarkOpacity?.N ? Number(p.watermarkOpacity.N) : null,
  });
  const cleanKey = cleanPreviewKey(keys.preview);
  let cleanWritten = false;
  const longEdge = previewLongEdge(
    p?.defaultPreviewResolution?.N ? Number(p.defaultPreviewResolution.N) : null,
  );

  const source = await bodyOf(keys.original);
  if (!source) throw new Error('That upload could not be read.');

  const offsetN = connectionRow?.Item?.boothClockOffsetMs?.N;
  const boothFields = booth
    ? await boothAssignment({
        eventId,
        sub,
        source,
        offsetMs: offsetN !== undefined ? Number(offsetN) : null,
      })
    : {};

  let previewWritten = false;
  let thumbnailWritten = false;
  let previewBytes = 0;

  try {
    const image = await Jimp.read(source);
    const width = image.width;
    const height = image.height;

    const preview = scaleToLongEdge(width, height, longEdge);
    if (preview.resized) image.resize({ w: preview.width, h: preview.height });
    // The unmarked preview, kept so the watermark can be redone live when the
    // photographer changes it (restamp-pro-photos). Best-effort: without it
    // this one photo keeps the watermark it was made with.
    if (cleanKey) {
      const cleanBody = await image.getBuffer('image/jpeg', { quality: PREVIEW_QUALITY });
      cleanWritten = await s3
        .send(
          new PutObjectCommand({ Bucket: BUCKET, Key: cleanKey, Body: cleanBody, ContentType: 'image/jpeg' }),
        )
        .then(() => true)
        .catch(() => false);
    }
    if (watermark) {
      // Applied to the derivative only. The original, if it is kept at all, is
      // returned to the photographer exactly as they sent it.
      await applyWatermark(image, watermark);
    }
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
          watermarkEnabled: { BOOL: Boolean(watermark) },
          ...(cleanWritten && cleanKey ? { cleanPreviewObjectKey: { S: cleanKey } } : {}),
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
