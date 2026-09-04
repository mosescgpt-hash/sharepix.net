// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const MOMENT_TABLE = process.env.MOMENT_TABLE_NAME as string;

type Handler = Schema['eventMoments']['functionHandler'];

export const handler: Handler = async (event) => {
  const eventId = event.arguments.eventId;
  if (!eventId) return [];

  // Scan + filter mirrors listEventPhotos and eventGuestBook. Moments are a
  // handful of rows per event, so this is the cheapest of the three by a wide
  // margin; it moves to the secondary index when those two do.
  const items: Record<string, { S?: string; N?: string }>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: MOMENT_TABLE,
        FilterExpression: '#eventId = :eventId',
        ExpressionAttributeNames: { '#eventId': 'eventId' },
        ExpressionAttributeValues: { ':eventId': { S: eventId } },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of result.Items ?? []) items.push(item);
    startKey = result.LastEvaluatedKey;
  } while (startKey);

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
