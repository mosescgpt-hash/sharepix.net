// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  DeleteItemCommand,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import {
  commentsEnabled,
  likesEnabled,
  normalizeGuestKey,
  reactionId,
  validateComment,
} from './photoEngagement';

const dynamo = new DynamoDBClient({});

const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const REACTION_TABLE = process.env.REACTION_TABLE_NAME as string;
const COMMENT_TABLE = process.env.COMMENT_TABLE_NAME as string;

/**
 * One answer for a photo that does not exist, one that belongs to another
 * event, and one whose event has this switched off.
 *
 * Distinguishing them would let someone map which photo ids are real by feeding
 * the endpoint guesses.
 */
const REFUSED = 'That photo could not be found.';

type LikeEvent = { arguments?: { photoId?: string; guestKey?: string } };
type CommentEvent = {
  arguments?: { photoId?: string; guestKey?: string; body?: string; author?: string };
};

/**
 * The photo AND the event it belongs to, or null.
 *
 * Both are read because everything that decides this request — whether the
 * event has likes on, whether it has comments on, who owns it — lives on the
 * event, and nothing that arrives from the browser is trusted for any of it.
 * The client sends a photo id; it does not get to say which event that is in.
 */
async function photoAndEvent(photoId: string) {
  if (!PHOTO_TABLE || !EVENT_TABLE || !photoId) return null;
  const photo = await dynamo
    .send(new GetItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: photoId } } }))
    .catch(() => null);
  if (!photo?.Item) return null;

  const eventId = photo.Item.eventId?.S ?? '';
  if (!eventId) return null;
  const event = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  if (!event?.Item) return null;

  return { photo: photo.Item, event: event.Item, eventId };
}

/** Move a counter on a photo, floored so it can never read negative. */
async function moveCount(photoId: string, field: string, delta: number): Promise<void> {
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: PHOTO_TABLE,
        Key: { id: { S: photoId } },
        UpdateExpression: `ADD ${field} :delta`,
        ...(delta < 0
          ? {
              // Only guard the downward move: ADD creates the attribute when it
              // is missing, which is what lets a photo that predates these
              // counters start counting from its first like.
              ConditionExpression: `attribute_exists(${field}) AND ${field} > :zero`,
              ExpressionAttributeValues: {
                ':delta': { N: String(delta) },
                ':zero': { N: '0' },
              },
            }
          : { ExpressionAttributeValues: { ':delta': { N: String(delta) } } }),
      }),
    )
    .catch(() => undefined);
}

/**
 * Like a photo, or take the like back.
 *
 * The conditional put is the whole rule: it succeeds exactly once per browser
 * per photo, so two taps in the same second cannot both count. A put that fails
 * the condition means this browser had already liked it, and the tap is read as
 * an unlike — which is what a person tapping a filled heart expects.
 *
 * The count moves only when the row actually changed, so a double-fire adds
 * nothing.
 */
async function toggleLike(event: LikeEvent): Promise<{ liked: boolean }> {
  const photoId = (event.arguments?.photoId ?? '').toString();
  const guestKey = normalizeGuestKey(event.arguments?.guestKey);
  if (!guestKey) throw new Error(REFUSED);

  const found = await photoAndEvent(photoId);
  if (!found) throw new Error(REFUSED);

  // The host's switch, enforced here rather than only in the UI. A gallery
  // that hides the button is not the same as an event that refuses the write.
  if (!likesEnabled({ reactionsEnabled: found.event.reactionsEnabled?.BOOL ?? null })) {
    throw new Error('Likes are turned off for this event.');
  }

  const id = reactionId(photoId, guestKey);
  const now = new Date().toISOString();

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: REACTION_TABLE,
        Item: {
          id: { S: id },
          __typename: { S: 'PhotoReaction' },
          photoId: { S: photoId },
          eventId: { S: found.eventId },
          guestKey: { S: guestKey },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') {
      throw new Error('That could not be saved.');
    }
    // Already liked: this tap is the unlike.
    await dynamo
      .send(new DeleteItemCommand({ TableName: REACTION_TABLE, Key: { id: { S: id } } }))
      .catch(() => undefined);
    await moveCount(photoId, 'likeCount', -1);
    return { liked: false };
  }

  await moveCount(photoId, 'likeCount', 1);
  return { liked: true };
}

/**
 * Leave a comment on a photo.
 *
 * The author name is whatever the guest typed, or their per-browser label —
 * exactly like an upload. It is not identity and is not treated as any.
 *
 * Nothing here screens the text. That is a deliberate absence rather than an
 * oversight: photo screening is Rekognition, text screening is a different
 * service with a different cost and its own failure modes, and implying a
 * filter that does not exist would be worse than the host moderation that does.
 */
async function addComment(event: CommentEvent): Promise<{ id: string; createdAt: string }> {
  const photoId = (event.arguments?.photoId ?? '').toString();
  const guestKey = normalizeGuestKey(event.arguments?.guestKey);
  if (!guestKey) throw new Error(REFUSED);

  const found = await photoAndEvent(photoId);
  if (!found) throw new Error(REFUSED);

  if (!commentsEnabled({ commentsEnabled: found.event.commentsEnabled?.BOOL ?? null })) {
    throw new Error('Comments are turned off for this event.');
  }

  const decision = validateComment({
    body: event.arguments?.body,
    author: event.arguments?.author,
  });
  if (!decision.ok) throw new Error(decision.reason ?? 'Write something first.');

  const now = new Date().toISOString();
  const id = randomUUID();

  await dynamo.send(
    new PutItemCommand({
      TableName: COMMENT_TABLE,
      Item: {
        id: { S: id },
        __typename: { S: 'PhotoComment' },
        photoId: { S: photoId },
        eventId: { S: found.eventId },
        // Stamped from the EVENT's stored owner, never from the request, or a
        // guest could file a comment under someone else's moderation queue.
        eventOwner: { S: found.event.owner?.S ?? '' },
        body: { S: decision.body as string },
        author: { S: decision.author || '' },
        guestKey: { S: guestKey },
        hidden: { BOOL: false },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
    }),
  );

  await moveCount(photoId, 'commentCount', 1);
  return { id, createdAt: now };
}

/**
 * One function, two mutations.
 *
 * An Amplify function has a single entry point, so the resolver's field name is
 * what selects the branch. They share this function rather than having one
 * each because they share everything that matters: the same photo-and-event
 * lookup, the same guest key, the same host switches, and the same rule that a
 * count and the row behind it move together.
 *
 * An unrecognised field is refused rather than falling through to a default. A
 * new mutation pointed at this function should fail loudly until someone wires
 * it, not quietly behave like a like.
 */
export const handler = async (event: LikeEvent & CommentEvent) => {
  const field = (event as { info?: { fieldName?: string } }).info?.fieldName ?? '';
  if (field === 'togglePhotoLike') return toggleLike(event);
  if (field === 'addPhotoComment') return addComment(event);
  throw new Error(REFUSED);
};
