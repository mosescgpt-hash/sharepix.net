// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { entryVisibleToGuests } from './visibility';

const dynamo = new DynamoDBClient({});
const ENTRY_TABLE = process.env.GUEST_BOOK_TABLE_NAME as string;

type Handler = Schema['eventGuestBook']['functionHandler'];

export const handler: Handler = async (event) => {
  const eventId = event.arguments.eventId;
  if (!eventId) return [];

  // Read every entry for this one event. Scan + filter mirrors
  // listEventPhotos: fine at pilot scale, and it moves to the secondary index
  // when the table justifies it.
  const items: Record<string, { S?: string; BOOL?: boolean }>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: ENTRY_TABLE,
        FilterExpression: '#eventId = :eventId',
        ExpressionAttributeNames: { '#eventId': 'eventId' },
        ExpressionAttributeValues: { ':eventId': { S: eventId } },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of result.Items ?? []) items.push(item);
    startKey = result.LastEvaluatedKey;
  } while (startKey);

  // This query serves guests, so it is where hiding and screening are
  // enforced. The host reads the model directly through owner auth and still
  // sees everything, which is how a held entry stays reviewable.
  return items
    .filter((item) =>
      entryVisibleToGuests({
        moderationStatus: item.moderationStatus?.S,
        hidden: item.hidden?.BOOL,
      }),
    )
    .map((item) => ({
      id: item.id?.S ?? '',
      eventId: item.eventId?.S ?? '',
      name: item.name?.S ?? '',
      message: item.message?.S ?? null,
      photoId: item.photoId?.S ?? null,
      createdAt: item.createdAt?.S ?? null,
    }))
    // Oldest first: a guest book reads as a record of the day, in order.
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
};
