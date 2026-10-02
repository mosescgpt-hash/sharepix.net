import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { Schema } from '../../data/resource';
import { needsContentReview } from './contentReview';

const dynamo = new DynamoDBClient({});
const lambda = new LambdaClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const TAKEDOWN_FUNCTION = process.env.TAKEDOWN_FUNCTION_NAME ?? '';

type Handler = Schema['removeHostedEvent']['functionHandler'];

/** What every successful removal says, whichever path it took. */
const REMOVED = { success: true, message: 'Event removed from your account.' };

/**
 * Remove an event from its host's account.
 *
 * ## An ordinary event is deleted, exactly as before
 *
 * The row goes. Nothing here changes what happens to an event nobody has
 * flagged or closed.
 *
 * ## A closed or flagged event is removed from the account and preserved
 *
 * If SharePix has closed the event, or its photos have crossed the content
 * review thresholds, the event is marked `hostDeletedAt`, closed quietly if it
 * was not already, and its media moved to quarantine. The host gets the same
 * answer as any removal, and the event is gone from their account: My Events
 * filters it out and its pages answer as a deleted event's would.
 *
 * The privacy policy says this happens: removing content takes it out of the
 * host's account, and content in an event under review or closed for
 * violating the Terms may be preserved. The admin list marks these events
 * "Removed by host" so it is never mistaken for an ordinary closure.
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
  const row = found.Item;
  // Already gone: removing it again is harmless.
  if (!row) return { success: true, message: 'Event already removed.' };

  const owner = row.owner?.S ?? '';
  if (!isAdmin && owner.split('::')[0] !== sub) {
    // The same answer a stranger would get for an id that does not exist.
    throw new Error('That event could not be removed.');
  }

  // Already removed by its host and preserved.
  if (row.hostDeletedAt?.S) return REMOVED;

  const closed = Boolean(row.takenDownAt?.S);
  const flagged = needsContentReview({
    flaggedCount: Number(row.flaggedCount?.N ?? '0'),
    photoCount: Number(row.photoCount?.N ?? '0'),
    contentReviewClearedCount: Number(row.contentReviewClearedCount?.N ?? '0'),
    takenDownAt: row.takenDownAt?.S ?? null,
  });

  if (closed || flagged) {
    await preserve(eventId, closed);
    return REMOVED;
  }

  // An ordinary event. Conditional on it still being open, so a closure that
  // lands between the read above and this write still wins.
  try {
    await dynamo.send(
      new DeleteItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        ConditionExpression: 'attribute_not_exists(takenDownAt)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    await preserve(eventId, true);
  }
  return REMOVED;
};

/**
 * Take the event out of its host's account for good, close it if it was not
 * already, and start moving its media to quarantine.
 *
 * The row is updated first, so the event leaves the host's account and stops
 * serving media at once; the move runs in the takedown function in the
 * background, because it can take minutes and the host is waiting on a button.
 * If that invoke fails the event is still hidden and closed, and an admin's
 * Close finishes the move.
 */
async function preserve(eventId: string, alreadyClosed: boolean): Promise<void> {
  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      UpdateExpression: alreadyClosed
        ? 'SET hostDeletedAt = :now'
        : 'SET hostDeletedAt = :now, takenDownAt = :now, takedownQuiet = :true, takedownNote = :note, uploadsClosed = :true, usageStatus = :restricted, usageNote = :usageNote',
      ExpressionAttributeValues: {
        ':now': { S: now },
        ...(alreadyClosed
          ? {}
          : {
              ':true': { BOOL: true },
              ':note': { S: 'Removed by its host while in content review; closed automatically.' },
              ':restricted': { S: 'RESTRICTED' },
              ':usageNote': { S: 'Closed for content review' },
            }),
      },
    }),
  );

  if (!TAKEDOWN_FUNCTION) {
    console.error('TAKEDOWN_FUNCTION_NAME is not set; media not moved to quarantine', { eventId });
    return;
  }
  // Shaped like the admin's AppSync call. Only callers granted invoke on the
  // takedown function can send this — this function, and nothing a browser
  // can reach.
  await lambda
    .send(
      new InvokeCommand({
        FunctionName: TAKEDOWN_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({
            arguments: { eventId, closed: true, quiet: true },
            identity: { groups: ['ADMINS'] },
          }),
        ),
      }),
    )
    .catch((error) =>
      console.error('Could not start moving a preserved event to quarantine', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
}
