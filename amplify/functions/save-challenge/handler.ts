import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue, QueryCommandOutput, ScanCommandOutput } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import { MAX_ACTIVE_CHALLENGES, MAX_CHALLENGES_PER_EVENT, validateChallenge } from './rules';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE_NAME as string;
const CHALLENGES_BY_EVENT_INDEX = 'challengesByEventId';

interface ChallengeView {
  id: string;
  eventId: string;
  text: string;
  order: number;
  active: boolean;
  createdAt: string | null;
}

interface Result {
  ok: boolean;
  message: string;
  challenge?: ChallengeView | null;
}

interface ResolverEvent {
  arguments?: Record<string, unknown>;
  identity?: { sub?: string; groups?: string[] | null } | null;
  info?: { fieldName?: string };
}

/** Same shape as mayEdit in update-event/settings.ts. */
function mayEdit(caller: ResolverEvent['identity'], owner: string): boolean {
  if ((caller?.groups ?? []).includes('ADMINS')) return true;
  const sub = caller?.sub;
  return !!sub && !!owner && owner.split('::')[0] === sub;
}

const NOT_FOUND: Result = { ok: false, message: 'That event could not be found.' };

/** How many challenges the event has, and how many are active. */
async function countChallenges(eventId: string): Promise<{ total: number; active: number }> {
  const counts = { total: 0, active: 0 };
  const tally = (items: Record<string, AttributeValue>[] | undefined) => {
    for (const item of items ?? []) {
      counts.total += 1;
      if (item.active?.BOOL !== false) counts.active += 1;
    }
  };
  let key: Record<string, AttributeValue> | undefined;
  try {
    do {
      const page: QueryCommandOutput = await dynamo.send(
        new QueryCommand({
          TableName: CHALLENGE_TABLE,
          IndexName: CHALLENGES_BY_EVENT_INDEX,
          KeyConditionExpression: '#e = :e',
          ExpressionAttributeNames: { '#e': 'eventId', '#a': 'active' },
          ExpressionAttributeValues: { ':e': { S: eventId } },
          ProjectionExpression: 'id, #a',
          ExclusiveStartKey: key,
        }),
      );
      tally(page.Items);
      key = page.LastEvaluatedKey;
    } while (key);
  } catch {
    counts.total = 0;
    counts.active = 0;
    key = undefined;
    do {
      const page: ScanCommandOutput = await dynamo.send(
        new ScanCommand({
          TableName: CHALLENGE_TABLE,
          FilterExpression: '#e = :e',
          ExpressionAttributeNames: { '#e': 'eventId', '#a': 'active' },
          ExpressionAttributeValues: { ':e': { S: eventId } },
          ProjectionExpression: 'id, #a',
          ExclusiveStartKey: key,
        }),
      );
      tally(page.Items);
      key = page.LastEvaluatedKey;
    } while (key);
  }
  return counts;
}

async function getChallenge(id: string) {
  if (!id) return null;
  const found = await dynamo
    .send(new GetItemCommand({ TableName: CHALLENGE_TABLE, Key: { id: { S: id } } }))
    .catch(() => null);
  return found?.Item ?? null;
}

async function save(eventId: string, args: Record<string, unknown>): Promise<Result> {
  const checked = validateChallenge({ text: args.text, order: args.order });
  if (!checked.ok) return { ok: false, message: checked.reason };
  const active = args.active !== false;
  const now = new Date().toISOString();
  const challengeId = typeof args.challengeId === 'string' ? args.challengeId.trim() : '';
  const tooMany = `An event can have ${MAX_ACTIVE_CHALLENGES} active challenges. Switch one off first.`;

  if (challengeId) {
    const existing = await getChallenge(challengeId);
    if (!existing || existing.eventId?.S !== eventId) return { ok: false, message: 'That challenge could not be found.' };
    const wasActive = existing.active?.BOOL !== false;
    if (active && !wasActive && (await countChallenges(eventId)).active >= MAX_ACTIVE_CHALLENGES) {
      return { ok: false, message: tooMany };
    }
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CHALLENGE_TABLE,
        Key: { id: { S: challengeId } },
        UpdateExpression: 'SET #t = :t, #o = :o, #a = :a, updatedAt = :now',
        ConditionExpression: 'attribute_exists(id) AND eventId = :e',
        ExpressionAttributeNames: { '#t': 'text', '#o': 'order', '#a': 'active' },
        ExpressionAttributeValues: {
          ':t': { S: checked.text },
          ':o': { N: String(checked.order) },
          ':a': { BOOL: active },
          ':now': { S: now },
          ':e': { S: eventId },
        },
      }),
    );
    return {
      ok: true,
      message: 'Saved.',
      challenge: {
        id: challengeId,
        eventId,
        text: checked.text,
        order: checked.order,
        active,
        createdAt: existing.createdAt?.S ?? now,
      },
    };
  }

  const counts = await countChallenges(eventId);
  if (counts.total >= MAX_CHALLENGES_PER_EVENT) {
    return { ok: false, message: 'This event has as many challenges as it can hold. Delete some first.' };
  }
  if (active && counts.active >= MAX_ACTIVE_CHALLENGES) return { ok: false, message: tooMany };

  const id = randomUUID();
  await dynamo.send(
    new PutItemCommand({
      TableName: CHALLENGE_TABLE,
      Item: {
        id: { S: id },
        __typename: { S: 'Challenge' },
        eventId: { S: eventId },
        text: { S: checked.text },
        order: { N: String(checked.order) },
        active: { BOOL: active },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
  return {
    ok: true,
    message: 'Added.',
    challenge: { id, eventId, text: checked.text, order: checked.order, active, createdAt: now },
  };
}

async function remove(eventId: string, args: Record<string, unknown>): Promise<Result> {
  const challengeId = typeof args.challengeId === 'string' ? args.challengeId.trim() : '';
  try {
    await dynamo.send(
      new DeleteItemCommand({
        TableName: CHALLENGE_TABLE,
        Key: { id: { S: challengeId } },
        // Only a challenge of THIS event, which the caller has been proven to own.
        ConditionExpression: 'eventId = :e',
        ExpressionAttributeValues: { ':e': { S: eventId } },
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return { ok: false, message: 'That challenge could not be found.' };
    }
    throw error;
  }
  return { ok: true, message: 'Deleted.' };
}

async function settings(eventId: string, args: Record<string, unknown>): Promise<Result> {
  const sets: string[] = ['updatedAt = :now'];
  const values: Record<string, AttributeValue> = { ':now': { S: new Date().toISOString() } };
  if (typeof args.enabled === 'boolean') {
    sets.push('challengesEnabled = :enabled');
    values[':enabled'] = { BOOL: args.enabled };
  }
  if (typeof args.captions === 'boolean') {
    sets.push('challengeCaptions = :captions');
    values[':captions'] = { BOOL: args.captions };
  }
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeValues: values,
    }),
  );
  return { ok: true, message: 'Saved.' };
}

export const handler = async (event: ResolverEvent): Promise<Result> => {
  const args = event.arguments ?? {};
  const eventId = typeof args.eventId === 'string' ? args.eventId.trim() : '';
  if (!eventId) return NOT_FOUND;
  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  // One answer for "no such event" and "not yours".
  if (!found?.Item || !mayEdit(event.identity, found.Item.owner?.S ?? '')) return NOT_FOUND;

  try {
    switch (event.info?.fieldName) {
      case 'saveChallenge':
        return await save(eventId, args);
      case 'removeChallenge':
        return await remove(eventId, args);
      case 'setChallengeSettings':
        return await settings(eventId, args);
      default:
        return { ok: false, message: 'Unknown request.' };
    }
  } catch (error) {
    console.error('save-challenge failed', {
      field: event.info?.fieldName,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Something went wrong. Try again in a moment.' };
  }
};
