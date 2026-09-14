import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { entryVisibleToGuests } from './visibility';

const dynamo = new DynamoDBClient({});
const ENTRY_TABLE = process.env.GUEST_BOOK_TABLE_NAME as string;

// The by-event index Amplify generates for
// `GuestBookEntry.secondaryIndexes([index('eventId')])`. Confirmed against the
// synthesised CloudFormation (`npm run validate:backend`), not guessed.
const ENTRIES_BY_EVENT_INDEX = 'guestBookEntriesByEventId';

type Handler = Schema['eventGuestBook']['functionHandler'];

export const handler: Handler = async (event) => {
  const eventId = event.arguments.eventId;
  if (!eventId) return [];

  // Read every entry for this one event, from the index. A filtered Scan reads
  // and bills for every row in the table — every other event's guest book
  // included — and discards all but one event's worth.
  //
  // The Scan survives only as a fallback for a missing or renamed index, which
  // would otherwise take every guest book down at once. It logs loudly, because
  // a fallback nobody notices is a Scan that came back permanently.
  const items: Record<string, { S?: string; BOOL?: boolean }>[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  try {
    do {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: ENTRY_TABLE,
          IndexName: ENTRIES_BY_EVENT_INDEX,
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
      index: ENTRIES_BY_EVENT_INDEX,
      error: error instanceof Error ? error.message : String(error),
    });
    // Discarded rather than merged: a partial page plus a full scan would show
    // some entries twice.
    items.length = 0;
    let scanKey: Record<string, AttributeValue> | undefined;
    do {
      const result = await dynamo.send(
        new ScanCommand({
          TableName: ENTRY_TABLE,
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
