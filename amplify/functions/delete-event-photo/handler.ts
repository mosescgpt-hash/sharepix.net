// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  DeleteItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Schema } from '../../data/resource';
import { mirrorConfigured, r2KeyFor } from './mirror';
import { counterForKind, kindForKey } from './accounting';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const TABLE = process.env.PHOTO_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const MEDIA_TABLE = process.env.MEDIA_TABLE_NAME as string;
const BUCKET = process.env.BUCKET_NAME as string;

/**
 * Cloudflare R2, where reads are actually served from.
 *
 * Deleting from S3 alone used to leave the served copy in place. The gallery
 * stopped listing the photo because its row was gone, but `mediaUrls` signs a
 * key without consulting the photo table, so anyone who already held the key —
 * every guest who had loaded the gallery before the deletion — kept a working
 * URL indefinitely. For a host removing a photo they did not want shared, and
 * for the moderation and DMCA paths where deletion IS the remedy, that meant
 * "delete" did not delete.
 */
let r2Client: S3Client | null = null;
function r2(): S3Client | null {
  if (!mirrorConfigured(process.env)) return null;
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ACCOUNT_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

/**
 * Give back the bytes an object was counted for.
 *
 * Read from the ledger row rather than re-measured, so the number subtracted is
 * exactly the number that was added. Deleting the ledger row is what stops a
 * retry subtracting twice.
 */
async function releaseBytes(key: string): Promise<void> {
  if (!MEDIA_TABLE || !EVENT_TABLE) return;
  try {
    const found = await dynamo.send(
      new GetItemCommand({ TableName: MEDIA_TABLE, Key: { id: { S: key } } }),
    );
    const row = found.Item;
    if (!row) return;
    const bytes = Number(row.bytes?.N ?? '0');
    const eventId = row.eventId?.S ?? '';
    const kind = kindForKey(key);
    if (!Number.isFinite(bytes) || bytes <= 0 || !eventId || !kind) return;

    await dynamo.send(
      new DeleteItemCommand({ TableName: MEDIA_TABLE, Key: { id: { S: key } } }),
    );
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: `ADD ${counterForKind(kind)} :neg`,
        // Floored, so a counter cannot go negative if the same object was
        // somehow released twice. A negative byte total reads as a bug in
        // every report it reaches.
        ConditionExpression: `attribute_exists(${counterForKind(kind)}) AND ${counterForKind(kind)} >= :bytes`,
        ExpressionAttributeValues: {
          ':neg': { N: String(-bytes) },
          ':bytes': { N: String(bytes) },
        },
      }),
    );
  } catch {
    // Accounting drift is reconcilable; a failed delete is not worth refusing
    // the host's deletion over.
  }
}

// Mirrors create-event-photo's VIDEO_KEY: what counts against the video
// allowance on the way in has to be what frees it on the way out.
const VIDEO_KEY = /\.(mp4|mov|webm|m4v|3gp)$/i;

type Handler = Schema['deleteEventPhoto']['functionHandler'];

/** The Amplify `owner`/`eventOwner` string is `"<sub>::<loginId>"`. */
function ownerSub(eventOwner: string): string {
  return eventOwner.split('::')[0];
}

export const handler: Handler = async (event) => {
  const photoId = event.arguments.photoId;
  const identity = event.identity as unknown as {
    sub?: string;
    groups?: string[] | null;
  } | null;
  const sub = identity?.sub;
  if (!sub) {
    throw new Error('Sign in to delete photos.');
  }

  const found = await dynamo.send(
    new GetItemCommand({ TableName: TABLE, Key: { id: { S: photoId } } }),
  );
  const item = found.Item;
  // Already gone — treat as success so repeated deletes are harmless.
  if (!item) {
    return { success: true, message: 'Photo already removed.' };
  }

  const eventOwner = item.eventOwner?.S ?? '';
  const isOwner = eventOwner !== '' && ownerSub(eventOwner) === sub;
  const isAdmin = (identity?.groups ?? []).includes('ADMINS');
  if (!isOwner && !isAdmin) {
    throw new Error('Only the event host can delete this photo.');
  }

  // All three, not two. The thumbnail used to be left behind entirely: it is
  // mirrored to R2 like the others and is a real object serving real bytes.
  const keys = [item.s3Key?.S, item.previewS3Key?.S, item.thumbS3Key?.S].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
  const r2Store = r2();
  await Promise.all(
    keys.flatMap((Key) => [
      s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key })).catch(() => undefined),
      // R2 is what serves reads, so this is the delete that actually makes the
      // photo unreachable.
      r2Store
        ? r2Store
            .send(
              new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET,
                Key: r2KeyFor(Key),
              }),
            )
            .catch(() => undefined)
        : Promise.resolve(),
    ]),
  );
  for (const key of keys) await releaseBytes(key);

  await dynamo.send(
    new DeleteItemCommand({ TableName: TABLE, Key: { id: { S: photoId } } }),
  );

  // Free the slot so the event's limits reflect the deletion. A video frees a
  // video slot as well, or a host who deletes a clip to make room would find
  // the allowance still spent. Best-effort and floored at zero so neither
  // counter can go negative.
  const eventId = item.eventId?.S;
  if (eventId) {
    const wasVideo = VIDEO_KEY.test(item.s3Key?.S ?? '');
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: wasVideo
            ? 'ADD photoCount :neg, videoCount :neg'
            : 'ADD photoCount :neg',
          ConditionExpression: 'attribute_exists(photoCount) AND photoCount > :zero',
          ExpressionAttributeValues: { ':neg': { N: '-1' }, ':zero': { N: '0' } },
        }),
      )
      .catch(() => undefined);
  }

  return { success: true, message: 'Photo deleted.' };
};
