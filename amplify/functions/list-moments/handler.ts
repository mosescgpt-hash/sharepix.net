import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const MOMENT_TABLE = process.env.MOMENT_TABLE_NAME as string;

// The by-event index Amplify generates for `Moment.secondaryIndexes([index('eventId')])`.
// Confirmed against the synthesised CloudFormation (`npm run validate:backend`
// writes it to .amplify/), not guessed — an earlier comment here said the name
// could not be known without a deploy, which is what kept this on a Scan.
const MOMENTS_BY_EVENT_INDEX = 'momentsByEventId';

type Handler = Schema['eventMoments']['functionHandler'];

export const handler: Handler = async (event) => {
  const eventId = event.arguments.eventId;
  if (!eventId) return [];

  // Query the index rather than scanning the table: a filtered Scan reads and
  // bills for every row in the table and throws away the ones for other events.
  // The Scan is kept as a fallback for the one failure a Query has and it does
  // not — the index missing or renamed — because that would take every event's
  // moments down at once. It logs loudly: a fallback nobody notices is a Scan
  // that came back permanently.
  const items: Record<string, { S?: string; N?: string }>[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  try {
    do {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: MOMENT_TABLE,
          IndexName: MOMENTS_BY_EVENT_INDEX,
          KeyConditionExpression: '#eventId = :eventId',
          ExpressionAttributeNames: { '#eventId': 'eventId' },
          ExpressionAttributeValues: { ':eventId': { S: eventId } },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of result.Items ?? []) items.push(item);
      startKey = result.LastEvaluatedKey;
    } while (startKey);
  } catch (error) {
    console.error('Falling back to a full table scan; the eventId index did not answer', {
      at: new Date().toISOString(),
      index: MOMENTS_BY_EVENT_INDEX,
      error: error instanceof Error ? error.message : String(error),
    });
    // Anything already collected is discarded rather than merged: a partial
    // page plus a full scan would list some moments twice.
    items.length = 0;
    let scanKey: Record<string, AttributeValue> | undefined;
    do {
      const result = await dynamo.send(
        new ScanCommand({
          TableName: MOMENT_TABLE,
          FilterExpression: '#eventId = :eventId',
          ExpressionAttributeNames: { '#eventId': 'eventId' },
          ExpressionAttributeValues: { ':eventId': { S: eventId } },
          ExclusiveStartKey: scanKey,
        }),
      );
      for (const item of result.Items ?? []) items.push(item);
      scanKey = result.LastEvaluatedKey;
    } while (scanKey);
  }

  return (
    items
      .map((item) => ({
        id: item.id?.S ?? '',
        eventId: item.eventId?.S ?? '',
        name: item.name?.S ?? '',
        description: item.description?.S ?? null,
        sortOrder: item.sortOrder?.N ? Number(item.sortOrder.N) : 0,
        createdAt: item.createdAt?.S ?? null,
      }))
      // Host order, oldest first on a tie. The same comparison as sortMoments
      // in lib/moments.ts — sorting here means every caller gets the order the
      // host set without having to remember to apply it.
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        const timeA = a.createdAt ? Date.parse(a.createdAt) : 0;
        const timeB = b.createdAt ? Date.parse(b.createdAt) : 0;
        if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
          return timeA - timeB;
        }
        return a.id.localeCompare(b.id);
      })
  );
};
