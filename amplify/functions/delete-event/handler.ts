import { DeleteItemCommand, DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

type Handler = Schema['removeHostedEvent']['functionHandler'];

/**
 * Delete an event row, for its host or an admin, unless it has been closed.
 *
 * A closed event is preserved: its content may have to be reported, and the
 * host whose event was closed is the last person who should be able to make
 * the record disappear. Nobody deletes one here — an admin reopens it first,
 * on purpose, if it really should go.
 */
export const handler: Handler = async (event) => {
  const identity = event.identity as { sub?: string; groups?: string[] | null } | null | undefined;
  const sub = (identity?.sub ?? '').trim();
  if (!sub) throw new Error('Sign in to remove an event.');
  const isAdmin = (identity?.groups ?? []).includes('ADMINS');

  const eventId = (event.arguments.eventId ?? '').trim();
  if (!eventId) throw new Error('Which event?');

  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  // Already gone: removing it again is harmless.
  if (!found.Item) return { success: true, message: 'Event already removed.' };

  const owner = found.Item.owner?.S ?? '';
  if (!isAdmin && owner.split('::')[0] !== sub) {
    // The same answer as a missing event would give a stranger, so this
    // cannot be used to learn which event ids exist.
    throw new Error('That event could not be removed.');
  }

  if (found.Item.takenDownAt?.S) {
    throw new Error('This event has been closed by SharePix and cannot be removed.');
  }

  // Conditional on the row still being open, so a closure that lands between
  // the read above and this write still wins.
  try {
    await dynamo.send(
      new DeleteItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        ConditionExpression: 'attribute_not_exists(takenDownAt)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new Error('This event has been closed by SharePix and cannot be removed.');
    }
    throw error;
  }
  return { success: true, message: 'Event removed.' };
};
