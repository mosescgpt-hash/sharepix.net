import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Jimp, loadFont } from 'jimp';
import type { Schema } from '../../data/resource';
import { connectionId, mayUploadToEvent } from './photographerAccess';
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
  watermarkFor,
} from './proProcessing';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const PROFILE_TABLE = process.env.PROFILE_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;

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
  const keepOriginal = p?.keepOriginals?.BOOL === true;
  const watermark = watermarkFor({
    watermarkEnabled: p?.watermarkEnabled?.BOOL ?? false,
    watermarkText: p?.watermarkText?.S ?? null,
    businessName: p?.businessName?.S ?? null,
  });
  const longEdge = previewLongEdge(
    p?.defaultPreviewResolution?.N ? Number(p.defaultPreviewResolution.N) : null,
  );

  const source = await bodyOf(keys.original);
  if (!source) throw new Error('That upload could not be read.');

  let previewWritten = false;
  let thumbnailWritten = false;
  let previewBytes = 0;

  try {
    const image = await Jimp.read(source);
    const width = image.width;
    const height = image.height;

    const preview = scaleToLongEdge(width, height, longEdge);
    if (preview.resized) image.resize({ w: preview.width, h: preview.height });
    if (watermark) {
      // Applied to the derivative only. The original, if it is kept at all, is
      // returned to the photographer exactly as they sent it.
      await stampWatermark(image, watermark);
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
          photographerId: { S: sub },
          ...(p?.businessName?.S ? { photographerName: { S: p.businessName.S } } : {}),
          ...(p?.website?.S ? { photographerWebsite: { S: p.website.S } } : {}),
          ...(p?.purchaseGalleryUrl?.S ? { purchaseUrl: { S: p.purchaseGalleryUrl.S } } : {}),
          ...(p?.contactUrl?.S ? { contactUrl: { S: p.contactUrl.S } } : {}),
          previewFileSize: { N: String(previewBytes) },
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

/**
 * Burn the photographer's name across the bottom of a preview.
 *
 * Deliberately plain: bottom-left, small, semi-transparent. A watermark that
 * dominates the frame makes the photographer's work look worse, which is the
 * opposite of why they turned it on.
 */
async function stampWatermark(image: Awaited<ReturnType<typeof Jimp.read>>, text: string) {
  const { SANS_16_WHITE, SANS_32_WHITE } = await import('jimp/fonts');
  const big = image.width > 1200;
  const font = await loadFont(big ? SANS_32_WHITE : SANS_16_WHITE);
  const pad = Math.round(image.width * 0.02);
  image.print({
    font,
    x: pad,
    y: Math.max(0, image.height - pad - (big ? 32 : 16)),
    text,
  });
}
