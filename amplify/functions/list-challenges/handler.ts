import { DynamoDBClient, GetItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { sortChallenges } from './rules';

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

interface ResolverEvent {
  arguments?: { eventId?: string | null };
  identity?: { sub?: string; groups?: string[] | null } | null;
}

function mayEdit(caller: ResolverEvent['identity'], owner: string): boolean {
  if ((caller?.groups ?? []).includes('ADMINS')) return true;
  const sub = caller?.sub;
  return !!sub && !!owner && owner.split('::')[0] === sub;
}

/** Every challenge row for an event, by index, falling back to a scan. */
export async function loadChallenges(eventId: string): Promise<ChallengeView[]> {
  const items: Record<string, AttributeValue>[] = [];
  const read = async (useIndex: boolean) => {
    let key: Record<string, AttributeValue> | undefined;
    do {
      const page = await dynamo.send(
        useIndex
          ? new QueryCommand({
              TableName: CHALLENGE_TABLE,
              IndexName: CHALLENGES_BY_EVENT_INDEX,
              KeyConditionExpression: '#e = :e',
              ExpressionAttributeNames: { '#e': 'eventId' },
              ExpressionAttributeValues: { ':e': { S: eventId } },
              ExclusiveStartKey: key,
            })
          : new ScanCommand({
              TableName: CHALLENGE_TABLE,
              FilterExpression: '#e = :e',
              ExpressionAttributeNames: { '#e': 'eventId' },
              ExpressionAttributeValues: { ':e': { S: eventId } },
              ExclusiveStartKey: key,
            }),
      );
      items.push(...(page.Items ?? []));
      key = page.LastEvaluatedKey;
    } while (key);
  };
  try {
    await read(true);
  } catch (error) {
    console.error('Falling back to a scan; the eventId index did not answer', {
      index: CHALLENGES_BY_EVENT_INDEX,
      error: error instanceof Error ? error.message : String(error),
    });
    items.length = 0;
    await read(false);
  }
  return items.map((item) => ({
    id: item.id?.S ?? '',
    eventId: item.eventId?.S ?? '',
    text: item.text?.S ?? '',
    order: item.order?.N ? Number(item.order.N) : 0,
    active: item.active?.BOOL !== false,
    createdAt: item.createdAt?.S ?? null,
  }));
}

export const handler = async (event: ResolverEvent): Promise<ChallengeView[]> => {
  const eventId = (event.arguments?.eventId ?? '').toString().trim();
  if (!eventId) return [];
  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  const ev = found?.Item;
  if (!ev) return [];

  // Guests get nothing while the switch is off or the event is closed for
  // abuse. The host and admins always get the list, so prompts can be set up
  // before the switch goes on.
  const host = mayEdit(event.identity, ev.owner?.S ?? '');
  if (!host && (ev.challengesEnabled?.BOOL !== true || ev.takenDownAt?.S)) return [];
  // Inactive prompts are included: the gallery still names them on its chips
  // when they have photos. The upload card shows only the active ones.
  return sortChallenges(await loadChallenges(eventId));
};
