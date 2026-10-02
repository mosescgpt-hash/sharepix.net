import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Schema } from '../../data/resource';
import {
  PHOTO_KEY_FIELDS,
  eventPrefix,
  quarantineKeyFor,
  quarantinePrefix,
  remapPhotoKeys,
  restoredKeyFor,
} from './quarantine';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET = process.env.BUCKET_NAME as string;
const PHOTOS_BY_EVENT_INDEX = 'photosByEventId';

/** Objects moved at once. Enough to be quick, few enough not to be throttled. */
const CONCURRENCY = 8;

/** Stop starting new work with this much of the Lambda's time left. */
const SAFETY_MS = 60_000;

type Handler = Schema['setEventTakedown']['functionHandler'];

/**
 * Cloudflare R2, where gallery reads are served from. A closed event's copies
 * there are deleted outright: R2 is a cache of S3, the S3 objects are what is
 * preserved, and a copy left in R2 is a copy still being served.
 */
let r2Client: S3Client | null = null;
function r2(): S3Client | null {
  const env = process.env;
  if (!env.R2_ACCOUNT_ENDPOINT || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return null;
  }
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: env.R2_ACCOUNT_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

/** CopySource wants the key URL-encoded, segment by segment. */
function copySource(key: string): string {
  return `${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/** Run `work` over `items`, a few at a time, until done or out of time. */
async function pool<T>(
  items: T[],
  work: (item: T) => Promise<void>,
  outOfTime: () => boolean,
): Promise<boolean> {
  let next = 0;
  let stopped = false;
  const runner = async () => {
    while (next < items.length) {
      if (outOfTime()) {
        stopped = true;
        return;
      }
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, runner));
  return !stopped;
}

/**
 * Move every object under `fromPrefix`, mapping each key with `map`.
 *
 * Copy first, delete the source only once the copy has succeeded, so an
 * object is never in neither place. A key `map` refuses is left alone.
 * Returns how many moved and whether the run finished.
 */
async function moveAll(
  fromPrefix: string,
  map: (key: string) => string | null,
  dropFromR2: boolean,
  outOfTime: () => boolean,
): Promise<{ moved: number; finished: boolean }> {
  const store = dropFromR2 ? r2() : null;
  let moved = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: fromPrefix, ContinuationToken: token }),
    );
    const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));
    const finished = await pool(
      keys,
      async (key) => {
        const target = map(key);
        if (!target) return;
        await s3.send(
          new CopyObjectCommand({
            Bucket: BUCKET,
            Key: target,
            CopySource: copySource(key),
            // Keep the metadata, including the `sanitized` marker, so a
            // restored original is not rewritten again by the upload trigger.
            MetadataDirective: 'COPY',
          }),
        );
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
        if (store) {
          await store
            .send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
            .catch((error) =>
              console.error('Could not remove an R2 copy', {
                key,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
        }
        moved += 1;
      },
      outOfTime,
    );
    if (!finished) return { moved, finished: false };
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return { moved, finished: true };
}

/** Rewrite every Photo row's keys for this event with `map`. */
async function rewritePhotoRows(
  eventId: string,
  map: (key: string) => string | null,
  outOfTime: () => boolean,
): Promise<boolean> {
  let start: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: PHOTO_TABLE,
        IndexName: PHOTOS_BY_EVENT_INDEX,
        KeyConditionExpression: '#eventId = :eventId',
        ExpressionAttributeNames: { '#eventId': 'eventId' },
        ExpressionAttributeValues: { ':eventId': { S: eventId } },
        ExclusiveStartKey: start,
      }),
    );
    const rows = page.Items ?? [];
    const finished = await pool(
      rows,
      async (row) => {
        const id = row.id?.S;
        if (!id) return;
        const current: Partial<Record<(typeof PHOTO_KEY_FIELDS)[number], string>> = {};
        for (const field of PHOTO_KEY_FIELDS) {
          const value = row[field]?.S;
          if (value) current[field] = value;
        }
        const changes = remapPhotoKeys(current, map);
        const fields = Object.keys(changes) as (typeof PHOTO_KEY_FIELDS)[number][];
        if (fields.length === 0) return;
        await dynamo.send(
          new UpdateItemCommand({
            TableName: PHOTO_TABLE,
            Key: { id: { S: id } },
            UpdateExpression: `SET ${fields.map((f) => `#${f} = :${f}`).join(', ')}`,
            ConditionExpression: 'attribute_exists(id)',
            ExpressionAttributeNames: Object.fromEntries(fields.map((f) => [`#${f}`, f])),
            ExpressionAttributeValues: Object.fromEntries(
              fields.map((f) => [`:${f}`, { S: changes[f] as string }]),
            ),
          }),
        );
      },
      outOfTime,
    );
    if (!finished) return false;
    start = page.LastEvaluatedKey;
  } while (start);
  return true;
}

export const handler: Handler = async (event, context) => {
  const groups = (event.identity as { groups?: string[] | null } | null | undefined)?.groups ?? [];
  if (!groups.includes('ADMINS')) {
    throw new Error('Only an admin can close or reopen an event.');
  }

  const eventId = (event.arguments.eventId ?? '').trim();
  if (!eventId) throw new Error('Which event?');
  const closing = event.arguments.closed === true;
  const note = (event.arguments.note ?? '').trim().slice(0, 500);
  const quiet = event.arguments.quiet === true;

  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  if (!found.Item) throw new Error('That event no longer exists.');

  const deadline = Date.now() + Math.max(0, context.getRemainingTimeInMillis() - SAFETY_MS);
  const outOfTime = () => Date.now() > deadline;
  const now = new Date().toISOString();

  if (closing) {
    // The row first, so access is refused from this moment even if the move
    // below is slow or does not finish: list-event-photos and media-url read
    // takenDownAt, and uploads stop on uploadsClosed.
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression:
          'SET takenDownAt = if_not_exists(takenDownAt, :now), uploadsClosed = :true, usageStatus = :restricted, usageNote = :usageNote, quarantineState = :moving, takedownQuiet = :quiet' +
          (note ? ', takedownNote = :note' : ''),
        ExpressionAttributeValues: {
          ':now': { S: now },
          ':true': { BOOL: true },
          ':restricted': { S: 'RESTRICTED' },
          ':usageNote': { S: 'Closed for content review' },
          ':moving': { S: 'moving' },
          ':quiet': { BOOL: quiet },
          ...(note ? { ':note': { S: note } } : {}),
        },
      }),
    );

    const toQuarantine = (key: string) => quarantineKeyFor(key, eventId);
    const files = await moveAll(eventPrefix(eventId), toQuarantine, true, outOfTime);
    const rows = files.finished && (await rewritePhotoRows(eventId, toQuarantine, outOfTime));
    if (!files.finished || !rows) {
      return {
        success: true,
        message: `Closed. ${files.moved} files moved so far; the event is large, so press Close again to finish moving the rest. It is already hidden.`,
      };
    }
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'SET quarantineState = :done, quarantinedAt = :now',
        ExpressionAttributeValues: { ':done': { S: 'done' }, ':now': { S: now } },
      }),
    );
    return {
      success: true,
      message: `Closed. ${files.moved} files moved to the admin-only quarantine; nothing was deleted.`,
    };
  }

  // Reopening: files and rows back first, and only then the row's state, so
  // a run that stops partway leaves the event still closed rather than open
  // with half its media missing.
  const toLive = (key: string) => restoredKeyFor(key, eventId);
  const files = await moveAll(quarantinePrefix(eventId), toLive, false, outOfTime);
  const rows = files.finished && (await rewritePhotoRows(eventId, toLive, outOfTime));
  if (!files.finished || !rows) {
    return {
      success: true,
      message: `Still closed. ${files.moved} files restored so far; press Reopen again to finish.`,
    };
  }
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      // uploadsClosed stays set: reopening the gallery is the admin's call,
      // reopening uploads is the host's.
      UpdateExpression:
        // hostDeletedAt stays: a host who removed the event does not get it
        // back because an admin reopened it.
        'REMOVE takenDownAt, takedownNote, takedownQuiet, usageStatus, usageNote, quarantineState, quarantinedAt',
    }),
  );
  return {
    success: true,
    message: `Reopened. ${files.moved} files restored. Uploads stay closed until the host reopens them.`,
  };
};
