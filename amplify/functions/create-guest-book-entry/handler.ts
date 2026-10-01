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
  MAX_ENTRIES_PER_ADDRESS,
  MAX_ENTRIES_PER_EVENT,
  MAX_ENTRIES_PER_GUEST,
  guestBookAvailable,
  screenEntryText,
  validateEntry,
} from './entry';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const ENTRY_TABLE = process.env.GUEST_BOOK_TABLE_NAME as string;
const QUOTA_TABLE = process.env.QUOTA_TABLE_NAME ?? '';

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

/**
 * Count one note against a limit, atomically, or report that it is spent.
 *
 * A missing table degrades to the per-event ceiling alone rather than
 * refusing every note: that ceiling still bounds the damage, and a guest
 * book that silently stopped taking entries mid-reception is the worse
 * failure. It is logged so the gap is visible.
 */
async function takeQuota(id: string, limit: number, eventId: string): Promise<boolean> {
  if (!QUOTA_TABLE) {
    console.error('QUOTA_TABLE_NAME is not set; per-guest guest book limits are off');
    return true;
  }
  const now = new Date().toISOString();
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: id } },
        UpdateExpression:
          'ADD #count :one SET #typename = if_not_exists(#typename, :typename), eventId = :eventId, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
        ExpressionAttributeNames: { '#count': 'count', '#typename': '__typename' },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':limit': { N: String(limit) },
          ':eventId': { S: eventId },
          ':now': { S: now },
          ':typename': { S: 'QuotaCounter' },
        },
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

/** Give a counted note back. Best-effort, like the event slot release below. */
async function releaseQuota(id: string): Promise<void> {
  if (!QUOTA_TABLE) return;
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: id } },
        UpdateExpression: 'ADD #count :neg',
        ConditionExpression: '#count > :zero',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':neg': { N: '-1' }, ':zero': { N: '0' } },
      }),
    )
    .catch(() => undefined);
}

/**
 * Who is signing, as far as the server can tell.
 *
 * A guest has no account, so "who" is the identity-pool id their browser was
 * given (or the user-pool sub for a signed-in host), and the network address
 * the request came from. Neither is taken from the request body.
 */
function signerKeys(
  identity: unknown,
  eventId: string,
): { guest: string | null; address: string | null } {
  const id = identity as
    | { sub?: string; cognitoIdentityId?: string; sourceIp?: string[] }
    | null
    | undefined;
  const who = (id?.sub ?? id?.cognitoIdentityId ?? '').trim();
  const ip = (id?.sourceIp?.[0] ?? '').trim();
  return {
    guest: who ? `guestbook#${eventId}#guest#${who}` : null,
    address: ip ? `guestbook#${eventId}#ip#${ip}` : null,
  };
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

  // Per guest first, then per address, then the event's own ceiling. Each one
  // taken is given back if a later one refuses, so a note that was never
  // stored never counts against anybody.
  const keys = signerKeys(event.identity, eventId);
  const taken: string[] = [];
  const giveBack = async () => {
    await Promise.all(taken.map((id) => releaseQuota(id)));
  };
  if (keys.guest) {
    if (!(await takeQuota(keys.guest, MAX_ENTRIES_PER_GUEST, eventId))) {
      throw new Error(
        `You have already left ${MAX_ENTRIES_PER_GUEST} notes in this guest book — thank you! Ask the host if you need to change one.`,
      );
    }
    taken.push(keys.guest);
  }
  if (keys.address) {
    if (!(await takeQuota(keys.address, MAX_ENTRIES_PER_ADDRESS, eventId))) {
      await giveBack();
      throw new Error('Too many notes have come from this network. Please try again later.');
    }
    taken.push(keys.address);
  }

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
    await giveBack();
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
    await giveBack();
    throw error;
  }

  return {
    // Set above, but the attribute type is optional; fall back rather than
    // assert a null is a string.
    id: item.id.S ?? '',
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
