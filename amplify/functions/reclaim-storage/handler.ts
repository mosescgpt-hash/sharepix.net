// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  DeleteItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mirrorConfigured, r2KeyFor } from './mirror';
import {
  reclaimSummary,
  reclaimVerdict,
  storedKeysOf,
  type ReclaimOutcome,
} from './storageReclaim';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const MEDIA_TABLE = process.env.MEDIA_TABLE_NAME as string;
const BUCKET = process.env.BUCKET_NAME as string;

/**
 * The tables holding what people wrote, as opposed to what they uploaded.
 *
 * A table whose name is not configured is SKIPPED, never guessed at. The
 * alternative — deriving a table name — would either delete from the wrong
 * table or from none while reporting success, and both are worse than a run
 * that says it could not do part of its job.
 */
const COMPANION_TABLES: Array<{ label: string; name: string }> = [
  { label: 'PhotoReaction', name: process.env.REACTION_TABLE_NAME ?? '' },
  { label: 'PhotoComment', name: process.env.COMMENT_TABLE_NAME ?? '' },
  { label: 'GuestBookEntry', name: process.env.GUEST_BOOK_TABLE_NAME ?? '' },
  { label: 'Moment', name: process.env.MOMENT_TABLE_NAME ?? '' },
];

/**
 * The switch. Nothing is deleted unless this is exactly 'true'.
 *
 * The same posture as EMAIL_SENDING_ENABLED, for a stronger reason: that one
 * gates sending an email nobody wanted, this one gates destroying photographs.
 * Off means the job runs completely — scans, decides, logs every event and
 * every key it would have removed — and deletes nothing. That is how a job like
 * this earns the right to be switched on.
 *
 * Deliberately a separate switch from the email one. A single flag over both
 * would eventually be flipped for the wrong reason.
 */
const RECLAIM_ENABLED = (process.env.STORAGE_RECLAIM_ENABLED ?? '').toLowerCase() === 'true';

/**
 * Retention per tier, duplicated because Lambda bundles cannot import lib/.
 *
 * Pinned by a test against lib/pricing.ts. A value here that is too SMALL
 * deletes inside a window the host was told they still had, so the test matters
 * more in that direction than the other.
 */
const RETENTION_DAYS: Record<string, number> = {
  free: 30,
  plus: 365,
  event: 365,
  starter: 21,
  standard: 90,
  premium: 365,
  corporate: 365,
};
const FALLBACK_RETENTION_DAYS = 90;

/**
 * How many events one run will reclaim.
 *
 * Bounded so a first run against a backlog cannot delete everything at once:
 * if this job is ever wrong, the difference between it being wrong about
 * twenty-five events and about every event in the table is the difference
 * between an incident and the end of the product.
 */
const MAX_EVENTS_PER_RUN = 25;

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

interface EventRow {
  id: string;
  tier: string;
  uploadWindowEndsAt: string | null;
  mediaReclaimedAt: string | null;
}

async function* allEvents(): AsyncGenerator<EventRow> {
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: EVENT_TABLE,
        ExclusiveStartKey: startKey,
        ProjectionExpression: '#id, tier, uploadWindowEndsAt, mediaReclaimedAt',
        // `id` is safest aliased.
        ExpressionAttributeNames: { '#id': 'id' },
      }),
    );
    for (const item of page.Items ?? []) {
      yield {
        id: item.id?.S ?? '',
        tier: item.tier?.S ?? '',
        uploadWindowEndsAt: item.uploadWindowEndsAt?.S ?? null,
        mediaReclaimedAt: item.mediaReclaimedAt?.S ?? null,
      };
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
}

interface PhotoRow {
  id: string;
  eventId: string;
  s3Key: string | null;
  previewS3Key: string | null;
  thumbS3Key: string | null;
}

/**
 * Every photo, grouped by event, in one scan.
 *
 * A scan rather than a query per event, and honestly so: no function in this
 * codebase queries a secondary index, and the generated index name cannot be
 * confirmed without a deploy. This job runs weekly against a table whose size
 * is bounded by the same retention it enforces, so one scan a week costs cents.
 * If that stops being true the fix is a query on the eventId index, not a
 * bigger scan.
 */
async function photosByEvent(): Promise<Map<string, PhotoRow[]>> {
  const byEvent = new Map<string, PhotoRow[]>();
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: PHOTO_TABLE,
        ExclusiveStartKey: startKey,
        ProjectionExpression: '#id, eventId, s3Key, previewS3Key, thumbS3Key',
        ExpressionAttributeNames: { '#id': 'id' },
      }),
    );
    for (const item of page.Items ?? []) {
      const eventId = item.eventId?.S ?? '';
      if (!eventId) continue;
      const rows = byEvent.get(eventId) ?? [];
      rows.push({
        id: item.id?.S ?? '',
        eventId,
        s3Key: item.s3Key?.S ?? null,
        previewS3Key: item.previewS3Key?.S ?? null,
        thumbS3Key: item.thumbS3Key?.S ?? null,
      });
      byEvent.set(eventId, rows);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return byEvent;
}

/**
 * Row ids in one companion table, grouped by the event they belong to.
 *
 * One scan per table, filtered to the events actually being reclaimed. Same
 * reasoning as photosByEvent: no function here queries a secondary index, the
 * generated index name cannot be confirmed without a deploy, and this runs
 * weekly against tables bounded by the retention it enforces. A FilterExpression
 * does the narrowing server-side so the pages coming back are small even when
 * the table is not.
 */
async function rowsByEvent(
  tableName: string,
  eventIds: Set<string>,
): Promise<Map<string, string[]>> {
  const byEvent = new Map<string, string[]>();
  if (!tableName || eventIds.size === 0) return byEvent;

  // `eventId IN (:e0, :e1, ...)`. The list is bounded by MAX_EVENTS_PER_RUN,
  // which is far below the 100 operands DynamoDB allows, so this cannot grow
  // into an expression the service rejects.
  const ids = [...eventIds];
  const idValues: Record<string, AttributeValue> = {};
  ids.forEach((id, i) => {
    idValues[`:e${i}`] = { S: id };
  });
  const filter = `eventId IN (${ids.map((_, i) => `:e${i}`).join(', ')})`;

  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: startKey,
        ProjectionExpression: '#id, eventId',
        FilterExpression: filter,
        ExpressionAttributeValues: idValues,
        // `id` is a reserved word; eventId is not, but aliasing one and not the
        // other is the sort of asymmetry that reads as a mistake later.
        ExpressionAttributeNames: { '#id': 'id' },
      }),
    );
    for (const item of page.Items ?? []) {
      const eventId = item.eventId?.S ?? '';
      const id = item.id?.S ?? '';
      // A row with no event id belongs to no event we can prove, so it is left
      // alone. Deleting rows we cannot attribute is not tidying up.
      if (!eventId || !id || !eventIds.has(eventId)) continue;
      const rows = byEvent.get(eventId) ?? [];
      rows.push(id);
      byEvent.set(eventId, rows);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return byEvent;
}

/** Delete one stored object from both stores. Best-effort in both. */
async function deleteObject(key: string): Promise<void> {
  const store = r2();
  await Promise.all([
    s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => undefined),
    store
      ? store
          .send(
            new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: r2KeyFor(key) }),
          )
          .catch(() => undefined)
      : Promise.resolve(),
  ]);
}

export const handler = async () => {
  const now = new Date();
  const nowISO = now.toISOString();
  const outcome: ReclaimOutcome = {
    eventsConsidered: 0,
    eventsReclaimed: 0,
    photosDeleted: 0,
    objectsDeleted: 0,
    recordsDeleted: 0,
    bytesFreed: 0,
    skipped: [],
    dryRun: !RECLAIM_ENABLED,
  };

  if (!EVENT_TABLE || !PHOTO_TABLE) {
    return { ok: false, dryRun: true, summary: 'Storage reclamation is not configured.' };
  }

  // Decide first, delete second. The whole set of events is judged before
  // anything is removed, so a failure partway through leaves a coherent state
  // rather than a half-judged table.
  const due: EventRow[] = [];
  for await (const event of allEvents()) {
    if (!event.id) continue;
    outcome.eventsConsidered += 1;
    const verdict = reclaimVerdict(
      event,
      RETENTION_DAYS[event.tier] ?? FALLBACK_RETENTION_DAYS,
      now,
    );
    if (verdict.reclaim) {
      due.push(event);
      continue;
    }
    // Only worth reporting the refusals that mean something is wrong with the
    // row. "Not yet" is the answer for almost every event, every week.
    if (verdict.reason === 'no-window-date' || verdict.reason === 'unparseable-date') {
      outcome.skipped.push({ eventId: event.id, reason: verdict.reason });
    }
  }

  const batch = due.slice(0, MAX_EVENTS_PER_RUN);
  const photos = batch.length > 0 ? await photosByEvent() : new Map<string, PhotoRow[]>();

  // What guests wrote: reactions, comments, guest book entries and moments.
  // Gathered once for the whole batch, before anything is deleted, for the same
  // reason the verdicts are: a failure partway through leaves a coherent state.
  //
  // A table whose name is not configured is reported and skipped. It must never
  // be silently treated as empty — that would let a deployment missing one
  // environment variable delete an event's photos and report success while
  // every comment written under them survived.
  const eventIds = new Set(batch.map((event) => event.id));
  const companions: Array<{ label: string; name: string; rows: Map<string, string[]> }> = [];
  for (const table of COMPANION_TABLES) {
    if (!table.name) {
      console.error('Companion table is not configured; its rows will NOT be reclaimed', {
        at: nowISO,
        table: table.label,
      });
      outcome.skipped.push({ eventId: '-', reason: `${table.label}-not-configured` });
      continue;
    }
    companions.push({
      label: table.label,
      name: table.name,
      rows: batch.length > 0 ? await rowsByEvent(table.name, eventIds) : new Map(),
    });
  }

  for (const event of batch) {
    const rows = photos.get(event.id) ?? [];
    const keys = rows.flatMap((row) => storedKeysOf(row));
    const records = companions.flatMap((table) =>
      (table.rows.get(event.id) ?? []).map((id) => ({ table: table.name, label: table.label, id })),
    );

    if (!RECLAIM_ENABLED) {
      // Dry run: say exactly what would go, and change nothing. Note that
      // mediaReclaimedAt is NOT set either, so switching the job on later
      // deletes what was due rather than skipping it as already done.
      console.log('[dry-run] would reclaim event media', {
        at: nowISO,
        eventId: event.id,
        tier: event.tier,
        photos: rows.length,
        objects: keys.length,
        records: records.length,
        // Broken out by table, because "412 records" tells an operator nothing
        // about whether the comments are actually being reached.
        recordsByTable: companions.map((table) => ({
          table: table.label,
          rows: (table.rows.get(event.id) ?? []).length,
        })),
      });
      outcome.eventsReclaimed += 1;
      outcome.photosDeleted += rows.length;
      outcome.objectsDeleted += keys.length;
      outcome.recordsDeleted += records.length;
      continue;
    }

    let failed = false;
    for (const key of keys) {
      await deleteObject(key);
      outcome.objectsDeleted += 1;
      // Drop the accounting row too, or a reclaimed event keeps a ledger of
      // objects that no longer exist.
      if (MEDIA_TABLE) {
        await dynamo
          .send(new DeleteItemCommand({ TableName: MEDIA_TABLE, Key: { id: { S: key } } }))
          .catch(() => undefined);
      }
    }

    // What guests wrote goes before the photo records do.
    //
    // If this run dies partway through, the surviving state is photos whose
    // comments are gone — recoverable, and the next run finishes it. The other
    // order leaves comments attached to photos that no longer exist, which is
    // the exact thing being fixed.
    //
    // A failure here sets `failed`, so mediaReclaimedAt stays unset and the
    // event is retried rather than marked done with rows still in the table.
    for (const record of records) {
      try {
        await dynamo.send(
          new DeleteItemCommand({ TableName: record.table, Key: { id: { S: record.id } } }),
        );
        outcome.recordsDeleted += 1;
      } catch (error) {
        failed = true;
        console.error('Could not delete a guest record during reclamation', {
          at: nowISO,
          eventId: event.id,
          table: record.label,
          recordId: record.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const row of rows) {
      try {
        await dynamo.send(
          new DeleteItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: row.id } } }),
        );
        outcome.photosDeleted += 1;
      } catch (error) {
        failed = true;
        console.error('Could not delete a photo record during reclamation', {
          at: nowISO,
          eventId: event.id,
          photoId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failed) {
      // Leave mediaReclaimedAt unset so the next run finishes the job. The
      // objects are already gone; what remains is bookkeeping, and marking it
      // done while records survive would strand them forever.
      outcome.skipped.push({ eventId: event.id, reason: 'partial-failure' });
      continue;
    }

    // Mark it, and zero the byte counters in the same write. An event whose
    // media is gone but whose counters still read 4 GB would keep showing up
    // at the top of the storage list forever.
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: event.id } },
          UpdateExpression:
            'SET mediaReclaimedAt = :now, photoBytes = :zero, videoBytes = :zero, derivedBytes = :zero',
          ExpressionAttributeValues: { ':now': { S: nowISO }, ':zero': { N: '0' } },
        }),
      )
      .catch(() => undefined);
    outcome.eventsReclaimed += 1;
  }

  if (due.length > batch.length) {
    console.log('Reclamation capped for this run', {
      at: nowISO,
      due: due.length,
      handled: batch.length,
      cap: MAX_EVENTS_PER_RUN,
    });
  }

  console.log('Storage reclamation complete', { at: nowISO, ...outcome });
  return { ok: true, dryRun: !RECLAIM_ENABLED, summary: reclaimSummary(outcome) };
};
