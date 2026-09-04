// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import {
  MAX_ENTRIES_PER_EVENT,
  guestBookAvailable,
  screenEntryText,
  validateEntry,
} from './entry';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const ENTRY_TABLE = process.env.GUEST_BOOK_TABLE_NAME as string;

type Handler = Schema['signGuestBook']['functionHandler'];

/**
 * Whether the event is still taking entries.
 *
 * The guest book closes when uploads close, deliberately: the guest book is
 * part of being at the event, not something people drift back to months later,
 * and tying it to the window the host already understands means there is one
 * rule to explain rather than two.
 */
function acceptingEntries(ev: Record<string, AttributeValue>): boolean {
  if (ev.uploadsClosed?.BOOL === true) return false;
  const endsAt = ev.uploadWindowEndsAt?.S;
  if (endsAt) {
    const ends = Date.parse(endsAt);
    if (Number.isFinite(ends) && ends < Date.now()) return false;
  }
  return true;
}

export const handler: Handler = async (event) => {
  const eventId = (event.arguments.eventId ?? '').trim();
  if (!eventId) throw new Error('Missing event.');

  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  const ev = found.Item;
  if (!ev) throw new Error('This event no longer exists.');

  // Same gate as uploads: an event awaiting payment is not active. A missing
  // `paid` (older events) reads as active, matching createEventPhoto.
  if (ev.paid?.BOOL === false) {
    throw new Error('This event is not active yet.');
  }

  if (!acceptingEntries(ev)) {
    throw new Error('This event is closed and is no longer accepting guest book entries.');
  }

  // The paid-feature gate, re-derived from the event's own row. The client
  // never says whether the guest book is on — it says which event, and the
  // answer comes from here.
  if (
    !guestBookAvailable({
      tier: ev.tier?.S ?? null,
      guestBookEnabled: ev.guestBookEnabled?.BOOL ?? null,
    })
  ) {
    throw new Error('This event does not have a guest book.');
  }

  const checked = validateEntry({
    name: event.arguments.name,
    message: event.arguments.message,
    photoId: event.arguments.photoId,
  });
  if (!checked.ok) throw new Error(checked.reason);
  const { name, message } = checked.entry;

  // An attached photo id is a claim, not a fact. Verify the photo exists AND
  // belongs to this event — without this a guest could attach any photo id they
  // can guess and pull another event's image into this album.
  let photoId: string | null = null;
  if (checked.entry.photoId) {
    const photo = await dynamo.send(
      new GetItemCommand({
        TableName: PHOTO_TABLE,
        Key: { id: { S: checked.entry.photoId } },
        ProjectionExpression: 'id, eventId',
      }),
    );
    if (photo.Item?.eventId?.S === eventId) {
      photoId = checked.entry.photoId;
    } else {
      // Don't fail the whole entry over it: the note is the thing the guest
      // came to leave, and a stale id is far likelier than an attack.
      console.warn('Guest book entry referenced a photo outside its event', {
        eventId,
        photoId: checked.entry.photoId,
      });
    }
  }

  // Nothing left to store once the photo reference is dropped.
  if (!message && !photoId) {
    throw new Error('Write a note, or attach a photo or video message.');
  }

  const screening = screenEntryText(message, ev.moderationMode?.S ?? null);

  // Reserve a slot atomically. This is an abuse bound on an unauthenticated
  // write endpoint, not a product limit — no real event approaches it.
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'ADD guestBookCount :one SET updatedAt = :now',
        ConditionExpression:
          'attribute_exists(id) AND (attribute_not_exists(guestBookCount) OR guestBookCount < :limit)',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':limit': { N: String(MAX_ENTRIES_PER_EVENT) },
          ':now': { S: new Date().toISOString() },
        },
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new Error('This guest book is full.');
    }
    throw error;
  }

  const now = new Date().toISOString();
  const item: Record<string, AttributeValue> = {
    id: { S: randomUUID() },
    __typename: { S: 'GuestBookEntry' },
    eventId: { S: eventId },
    // Stamped from the event, never from the caller: this is what lets the host
    // read and moderate every entry on their own event through owner auth.
    eventOwner: { S: ev.owner?.S ?? '' },
    name: { S: name },
    moderationStatus: { S: screening.status },
    hidden: { BOOL: false },
    createdAt: { S: now },
    updatedAt: { S: now },
  };
  if (message) item.message = { S: message };
  if (photoId) item.photoId = { S: photoId };
  if (screening.reasons.length > 0) {
    item.moderationReasons = { S: screening.reasons.join(', ') };
  }

  try {
    await dynamo.send(new PutItemCommand({ TableName: ENTRY_TABLE, Item: item }));
  } catch (error) {
    // Give the reserved slot back so a failed write can't permanently consume
    // one, the same way createEventPhoto releases a photo slot.
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: 'ADD guestBookCount :neg',
          ConditionExpression: 'attribute_exists(guestBookCount) AND guestBookCount > :zero',
          ExpressionAttributeValues: { ':neg': { N: '-1' }, ':zero': { N: '0' } },
        }),
      )
      .catch(() => undefined);
    throw error;
  }

  return {
    id: item.id.S,
    eventId,
    name,
    message: message || null,
    photoId,
    // The guest is told when their note is waiting on the host, rather than
    // being shown a page it silently isn't on.
    pending: screening.status === 'flagged',
    createdAt: now,
  };
};
