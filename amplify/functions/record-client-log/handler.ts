import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import type { Schema } from '../../data/resource';
import { LOG_RETENTION_DAYS, problemCount, sanitizeBatch } from './clientLogSchema';

const dynamo = new DynamoDBClient({});
const LOG_TABLE = process.env.CLIENT_LOG_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

type Handler = Schema['recordClientLog']['functionHandler'];

/** Entries one device may store per event per day. A bad day is a few dozen. */
export const DEVICE_DAILY_ENTRIES = 500;
/** Entries one signed-in or guest identity may store per scope per day, across devices. */
export const CALLER_DAILY_ENTRIES = 1000;
/** Entries one event, or one account, may store per day, across everyone. */
export const SCOPE_DAILY_ENTRIES = 20000;
/** Counter rows are only needed for the day they count. */
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

const EVENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
/** Whether an event exists, remembered briefly so a busy event is one read, not thousands. */
const knownEvents = new Map<string, { exists: boolean; until: number }>();

async function eventExists(eventId: string): Promise<boolean> {
  const cached = knownEvents.get(eventId);
  if (cached && cached.until > Date.now()) return cached.exists;
  const found = await dynamo.send(
    new GetItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      ProjectionExpression: 'id',
    }),
  );
  const exists = Boolean(found.Item);
  knownEvents.set(eventId, { exists, until: Date.now() + (exists ? 5 * 60_000 : 60_000) });
  return exists;
}

/**
 * Count `n` entries against a limit, atomically, or report that it is spent.
 *
 * The count and the limit are checked in one conditional write, so two batches
 * arriving together cannot both squeeze under it. Counter rows live in the log
 * table, expire by TTL after two days, and carry no ClientLog fields, so they
 * never appear in either index.
 */
async function takeQuota(id: string, n: number, limit: number, expiresAt: number): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: LOG_TABLE,
        Key: { id: { S: id } },
        UpdateExpression:
          'ADD #count :n SET #typename = if_not_exists(#typename, :typename), expiresAt = :expires, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count <= :room',
        ExpressionAttributeNames: { '#count': 'count', '#typename': '__typename' },
        ExpressionAttributeValues: {
          ':n': { N: String(n) },
          ':room': { N: String(limit - n) },
          ':expires': { N: String(expiresAt) },
          ':now': { S: now },
          ':typename': { S: 'ClientLogQuota' },
        },
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

/**
 * Store a batch, or quietly decline to.
 *
 * Always answers `true`. Diagnostics are telemetry: a device that cannot log
 * must not be told something went wrong, and a caller that could tell which
 * limit it hit could probe them. The reasons go to the function's own log.
 *
 * Where a batch lands is decided here, never by the request: an event the
 * caller names (which must exist), or else the caller's own account when they
 * are signed in. An anonymous batch with no event is dropped.
 */
export const handler: Handler = async (event) => {
  if (!LOG_TABLE || !EVENT_TABLE) {
    console.error('Client logging is not configured');
    return true;
  }

  const batch = sanitizeBatch(event.arguments?.batchJson);
  if (!batch) {
    console.warn('Declined a malformed or empty log batch');
    return true;
  }

  const identity = event.identity as unknown as {
    sub?: string;
    cognitoIdentityId?: string;
  } | null;
  const caller = (identity?.sub ?? identity?.cognitoIdentityId ?? '').trim();

  const named = (event.arguments?.eventId ?? '').toString().trim();
  let scope: string;
  if (named) {
    if (!EVENT_ID_PATTERN.test(named) || !(await eventExists(named))) {
      console.warn('Declined a log batch for an event that does not exist');
      return true;
    }
    scope = named;
  } else if (identity?.sub) {
    scope = `acct#${identity.sub}`;
  } else {
    return true;
  }

  const received = new Date();
  const day = received.toISOString().slice(0, 10).replace(/-/g, '');
  const counterExpiry = Math.floor(received.getTime() / 1000) + COUNTER_TTL_SECONDS;
  const n = batch.entries.length;
  const limits: Array<[string, number]> = [
    [`clientlog#${scope}#dev#${batch.deviceId}#${day}`, DEVICE_DAILY_ENTRIES],
    ...(caller ? ([[`clientlog#${scope}#who#${caller}#${day}`, CALLER_DAILY_ENTRIES]] as Array<[string, number]>) : []),
    [`clientlog#${scope}#all#${day}`, SCOPE_DAILY_ENTRIES],
  ];
  for (const [id, limit] of limits) {
    if (!(await takeQuota(id, n, limit, counterExpiry))) {
      console.warn('Declined a log batch over its daily limit', { limit });
      return true;
    }
  }

  const now = received.toISOString();
  await dynamo.send(
    new PutItemCommand({
      TableName: LOG_TABLE,
      Item: {
        id: { S: randomUUID() },
        __typename: { S: 'ClientLog' },
        eventId: { S: scope },
        deviceId: { S: batch.deviceId },
        sessionId: { S: batch.sessionId },
        // Stamped here, never from the request. Entries carry only their age.
        ts: { S: now },
        deviceKey: { S: `${batch.deviceId}#${now}` },
        entriesJson: { S: JSON.stringify(batch.entries) },
        ...(batch.device ? { deviceJson: { S: JSON.stringify(batch.device) } } : {}),
        ...(batch.build ? { build: { S: batch.build } } : {}),
        entryCount: { N: String(n) },
        problemCount: { N: String(problemCount(batch.entries)) },
        // Epoch seconds, as DynamoDB's TTL requires.
        expiresAt: { N: String(Math.floor(received.getTime() / 1000) + LOG_RETENTION_DAYS * 86400) },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
    }),
  );
  return true;
};
