import { randomBytes } from 'node:crypto';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import {
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MINUTES,
  actorMay,
  connectionId,
  isConnectionStatus,
  normalizePairingCode,
  pairingCodeUsable,
  type ConnectionStatus,
} from './photographerAccess';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const CODE_TABLE = process.env.PAIRING_TABLE_NAME as string;

const DENIED = 'That event could not be found.';

type Handler = Schema['connectPhotographer']['functionHandler'];

/** Uniform over the alphabet. Modulo bias would shrink the keyspace quietly. */
function pairingCode(): string {
  const out: string[] = [];
  while (out.length < PAIRING_CODE_LENGTH) {
    for (const byte of randomBytes(PAIRING_CODE_LENGTH)) {
      if (byte >= 256 - (256 % PAIRING_ALPHABET.length)) continue;
      out.push(PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]);
      if (out.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return out.join('');
}

/**
 * Host invites, photographer accepts — and nobody does both.
 *
 * ## Three actions, three different callers
 *
 * - `invite` — the host of the event. Mints a single-use pairing code.
 * - `pair` — a photographer holding that code. Creates their connection,
 *   already accepted, because redeeming a code the host handed them IS the
 *   acceptance.
 * - `remove` — either side.
 *
 * `actorMay` is what stops the obvious attacks: a host cannot accept on a
 * photographer's behalf (that fabricates consent) and a photographer cannot
 * re-admit themselves after being removed. The actor is derived here from
 * whether the caller owns the event, never from the request.
 */
export const handler: Handler = async (event) => {
  const sub = event.identity && 'sub' in event.identity ? String(event.identity.sub) : '';
  const groups =
    event.identity && 'groups' in event.identity
      ? ((event.identity.groups as string[] | null) ?? [])
      : [];
  if (!sub) throw new Error(DENIED);

  const action = String(event.arguments.action ?? '');

  if (action === 'pair') return pair(sub, String(event.arguments.code ?? ''));

  const eventId = String(event.arguments.eventId ?? '');
  const row = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  const owner = row?.Item?.owner?.S ?? '';
  if (!row?.Item) throw new Error(DENIED);

  const isHost = owner.split('::')[0] === sub;
  const isAdmin = groups.includes('ADMINS');
  const actor = isHost || isAdmin ? ('host' as const) : ('photographer' as const);

  if (action === 'invite') {
    if (!isHost && !isAdmin) throw new Error(DENIED);
    if (!actorMay(actor, 'removed', 'invited')) throw new Error(DENIED);

    const code = pairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000).toISOString();
    await dynamo.send(
      new PutItemCommand({
        TableName: CODE_TABLE,
        Item: {
          id: { S: code },
          __typename: { S: 'PhotographerPairingCode' },
          eventId: { S: eventId },
          eventOwner: { S: owner },
          expiresAt: { S: expiresAt },
          createdAt: { S: new Date().toISOString() },
        },
        // Two invitations issued in the same millisecond must not collide onto
        // one code and let the second host's photographer join the first event.
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
    // The only time this code is ever returned. It is not readable afterwards
    // by anyone — a code sitting in a query result is a code that leaked.
    return { ok: true, code, message: `Give this to your photographer. It expires in ${PAIRING_CODE_TTL_MINUTES} minutes.` };
  }

  if (action === 'remove') {
    const photographerId = String(event.arguments.photographerId ?? '') || sub;
    // A host removes anybody on their event; a photographer removes only
    // themselves.
    if (!isHost && !isAdmin && photographerId !== sub) throw new Error(DENIED);

    const id = connectionId(eventId, photographerId);
    const current = await dynamo
      .send(new GetItemCommand({ TableName: CONNECTION_TABLE, Key: { id: { S: id } } }))
      .catch(() => null);
    const from = current?.Item?.status?.S ?? '';
    if (!isConnectionStatus(from)) throw new Error(DENIED);
    if (!actorMay(actor, from, 'removed')) throw new Error(DENIED);

    await dynamo.send(
      new UpdateItemCommand({
        TableName: CONNECTION_TABLE,
        Key: { id: { S: id } },
        UpdateExpression:
          'SET #s = :removed, removedAt = :now, removedBy = :by, livePublishing = :off',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: {
          ':removed': { S: 'removed' satisfies ConnectionStatus },
          ':now': { S: new Date().toISOString() },
          ':by': { S: sub },
          // Removal stops publishing on the next request rather than waiting
          // for a session to expire.
          ':off': { BOOL: false },
        },
      }),
    );
    return { ok: true, code: null, message: 'Removed.' };
  }

  throw new Error(DENIED);
};

/**
 * Redeem a pairing code.
 *
 * The code is a bearer credential, so it is single-use and short-lived, and
 * both facts are checked against the stored row rather than anything the
 * caller sent. Marking it used is conditional on it still being unused, so two
 * photographers racing one code produce one connection.
 */
async function pair(sub: string, rawCode: string) {
  const code = normalizePairingCode(rawCode);
  if (!code) throw new Error('That code is not valid.');

  const found = await dynamo
    .send(new GetItemCommand({ TableName: CODE_TABLE, Key: { id: { S: code } } }))
    .catch(() => null);
  const item = found?.Item;
  if (
    !item ||
    !pairingCodeUsable({ expiresAt: item.expiresAt?.S ?? null, usedAt: item.usedAt?.S ?? null })
  ) {
    // One answer for expired, used, and never existed.
    throw new Error('That code is not valid.');
  }

  const eventId = item.eventId?.S ?? '';
  const now = new Date().toISOString();

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CODE_TABLE,
        Key: { id: { S: code } },
        UpdateExpression: 'SET usedAt = :now, usedBy = :by',
        ConditionExpression: 'attribute_not_exists(usedAt)',
        ExpressionAttributeValues: { ':now': { S: now }, ':by': { S: sub } },
      }),
    );
  } catch {
    throw new Error('That code is not valid.');
  }

  await dynamo.send(
    new PutItemCommand({
      TableName: CONNECTION_TABLE,
      Item: {
        id: { S: connectionId(eventId, sub) },
        __typename: { S: 'EventPhotographer' },
        eventId: { S: eventId },
        photographerId: { S: sub },
        owner: { S: sub },
        eventOwner: { S: item.eventOwner?.S ?? '' },
        // Redeeming a code the host handed over IS the acceptance.
        status: { S: 'accepted' satisfies ConnectionStatus },
        invitedAt: { S: item.createdAt?.S ?? now },
        acceptedAt: { S: now },
        // Paused until they choose otherwise. Nobody gets live publishing by
        // not deciding.
        livePublishing: { BOOL: false },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
    }),
  );

  return { ok: true, code: null, message: 'You are on the event.', eventId };
}
