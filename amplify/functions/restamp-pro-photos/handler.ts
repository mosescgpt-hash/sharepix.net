import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Jimp } from 'jimp';
import { PREVIEW_QUALITY, THUMBNAIL_QUALITY, scaleToLongEdge } from './proProcessing';
import { THUMBNAIL_LONG_EDGE } from './professionalMedia';
import { applyWatermark } from './stamp';
import { watermarkSpec } from './watermark';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const PROFILE_TABLE = process.env.PROFILE_TABLE_NAME as string;
const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;

const CONNECTIONS_BY_PHOTOGRAPHER = 'eventPhotographersByPhotographerId';
const PHOTOS_BY_EVENT = 'photosByEventId';

/** Enough for any real photographer; bounded so one run cannot run away. */
const MAX_PHOTOS = 3000;
const CONCURRENCY = 4;

async function bytes(key: string): Promise<Buffer | null> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => null);
  if (!res?.Body) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Every photo of this photographer that has an unmarked copy to restamp from. */
async function photosOf(photographerId: string): Promise<Record<string, AttributeValue>[]> {
  const connections = await dynamo.send(
    new QueryCommand({
      TableName: CONNECTION_TABLE,
      IndexName: CONNECTIONS_BY_PHOTOGRAPHER,
      KeyConditionExpression: 'photographerId = :p',
      ExpressionAttributeValues: { ':p': { S: photographerId } },
    }),
  );
  const eventIds = [...new Set((connections.Items ?? []).map((c) => c.eventId?.S).filter(Boolean))] as string[];
  const out: Record<string, AttributeValue>[] = [];
  for (const eventId of eventIds) {
    let start: Record<string, AttributeValue> | undefined;
    do {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: PHOTO_TABLE,
          IndexName: PHOTOS_BY_EVENT,
          KeyConditionExpression: 'eventId = :e',
          FilterExpression: 'photographerId = :p AND attribute_exists(cleanPreviewObjectKey)',
          ExpressionAttributeValues: { ':e': { S: eventId }, ':p': { S: photographerId } },
          ExclusiveStartKey: start,
        }),
      );
      out.push(...(res.Items ?? []));
      start = res.LastEvaluatedKey;
    } while (start && out.length < MAX_PHOTOS);
    if (out.length >= MAX_PHOTOS) break;
  }
  return out.slice(0, MAX_PHOTOS);
}

/**
 * Redo every watermark this photographer has, from the clean copies, with
 * their current settings — including taking it off. Each photo is
 * independent: one that fails keeps its old preview and the rest carry on.
 */
export const handler = async (event: { photographerId?: string }) => {
  const photographerId = String(event?.photographerId ?? '');
  if (!photographerId) return { restamped: 0 };

  const profile = await dynamo.send(
    new GetItemCommand({ TableName: PROFILE_TABLE, Key: { id: { S: photographerId } } }),
  );
  const p = profile.Item;
  const spec = watermarkSpec({
    watermarkEnabled: p?.watermarkEnabled?.BOOL ?? false,
    watermarkText: p?.watermarkText?.S ?? null,
    businessName: p?.businessName?.S ?? null,
    watermarkStyle: p?.watermarkStyle?.S ?? null,
    watermarkLogo: p?.watermarkLogo?.S ?? null,
    watermarkPosition: p?.watermarkPosition?.S ?? null,
    watermarkOpacity: p?.watermarkOpacity?.N ? Number(p.watermarkOpacity.N) : null,
  });

  const photos = await photosOf(photographerId);
  let restamped = 0;
  let next = 0;
  const worker = async () => {
    while (next < photos.length) {
      const item = photos[next++];
      const clean = item.cleanPreviewObjectKey?.S;
      const previewKey = item.previewObjectKey?.S;
      const thumbKey = item.thumbnailObjectKey?.S;
      if (!clean || !previewKey) continue;
      try {
        const source = await bytes(clean);
        if (!source) continue;
        const image = await Jimp.read(source);
        if (spec) await applyWatermark(image, spec);
        const previewBody = await image.getBuffer('image/jpeg', { quality: PREVIEW_QUALITY });
        await s3.send(
          new PutObjectCommand({ Bucket: BUCKET, Key: previewKey, Body: previewBody, ContentType: 'image/jpeg' }),
        );
        if (thumbKey) {
          const t = scaleToLongEdge(image.width, image.height, THUMBNAIL_LONG_EDGE);
          if (t.resized) image.resize({ w: t.width, h: t.height });
          const thumbBody = await image.getBuffer('image/jpeg', { quality: THUMBNAIL_QUALITY });
          await s3.send(
            new PutObjectCommand({ Bucket: BUCKET, Key: thumbKey, Body: thumbBody, ContentType: 'image/jpeg' }),
          );
        }
        await dynamo.send(
          new UpdateItemCommand({
            TableName: PHOTO_TABLE,
            Key: { id: { S: item.id?.S ?? '' } },
            UpdateExpression: 'SET watermarkEnabled = :w, updatedAt = :now',
            ConditionExpression: 'photographerId = :p',
            ExpressionAttributeValues: {
              ':w': { BOOL: Boolean(spec) },
              ':now': { S: new Date().toISOString() },
              ':p': { S: photographerId },
            },
          }),
        );
        restamped += 1;
      } catch (error) {
        console.error('Restamp failed for one photo; it keeps its old preview', {
          id: item.id?.S,
          error: (error as Error).message,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log('Restamped', { photographerId, restamped, of: photos.length });
  return { restamped };
};
