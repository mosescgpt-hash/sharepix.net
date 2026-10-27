import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { isValidPin, signAccessToken } from './galleryGate';
import {
  MAX_FAILURES_PER_EVENT,
  MAX_FAILURES_PER_IP,
  eventCounterId,
  hashPin,
  ipCounterId,
  newTokenKey,
  secondsLeftInWindow,
  verifyPin,
  windowOf,
} from './pin';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PIN_TABLE = process.env.GALLERY_PIN_TABLE_NAME as string;
const QUOTA_TABLE = process.env.QUOTA_TABLE_NAME as string;

type Result = Schema['verifyGalleryPin']['returnType'];

interface Request {
  info?: { fieldName?: string };
  fieldName?: string;
  arguments?: { eventId?: string; pin?: string | null; action?: string | null };
  identity?: {
    sub?: string;
    groups?: string[] | null;
    sourceIp?: string[];
  } | null;
}

const NOT_FOUND: Result = { ok: false, message: 'That gallery could not be found.' };
const WRONG: Result = { ok: false, message: 'That PIN is not right.' };

function locked(now: number): Result {
  return {
    ok: false,
    message: 'Too many wrong PINs. Please wait a few minutes and try again.',
    retryAfterSeconds: secondsLeftInWindow(now),
  };
}

/**
 * Reserve one guess against a counter, atomically. False means the limit is
 * already spent. Reserved before the PIN is checked (and handed back if it was
 * right) so a burst of parallel guesses cannot all slip past a read-then-write.
 */
async function reserve(id: string, limit: number, eventId: string, now: number): Promise<boolean> {
  const nowIso = new Date(now).toISOString();
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: id } },
        UpdateExpression:
          'ADD #count :one SET #typename = if_not_exists(#typename, :typename), eventId = :eventId, expiresAt = :expires, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
        ExpressionAttributeNames: { '#count': 'count', '#typename': '__typename' },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':limit': { N: String(limit) },
          ':eventId': { S: eventId },
          // When the window's count stops mattering; nothing reads it after.
          ':expires': { S: new Date(now + 24 * 60 * 60 * 1000).toISOString() },
          ':now': { S: nowIso },
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

async function refund(id: string): Promise<void> {
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: id } },
        UpdateExpression: 'ADD #count :minus',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':minus': { N: '-1' } },
      }),
    )
    .catch((error) => console.error('could not hand back a PIN guess', error));
}

async function getItem(table: string, id: string) {
  const out = await dynamo.send(new GetItemCommand({ TableName: table, Key: { id: { S: id } } }));
  return out.Item as Record<string, AttributeValue> | undefined;
}

async function setPinFlag(eventId: string, set: boolean): Promise<void> {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      UpdateExpression: 'SET galleryPinSet = :set, updatedAt = :now',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeValues: { ':set': { BOOL: set }, ':now': { S: new Date().toISOString() } },
    }),
  );
}

/** Same ownership rule as update-event: "<sub>::<login>", compared on the sub. */
function mayManage(identity: Request['identity'], owner: string): boolean {
  if ((identity?.groups ?? []).includes('ADMINS')) return true;
  const sub = identity?.sub;
  if (!sub || !owner) return false;
  return owner.split('::')[0] === sub;
}

/** The PIN is checked against the stored hash with both guess limits applied. */
async function guardedCheck(
  eventId: string,
  pin: string,
  ip: string,
  now: number,
): Promise<{ result: 'ok'; tokenKey: string } | { result: 'locked' | 'wrong' | 'none' }> {
  const row = await getItem(PIN_TABLE, eventId);
  const hash = row?.pinHash?.S;
  const tokenKey = row?.tokenKey?.S;
  if (!hash || !tokenKey) return { result: 'none' };

  const window = windowOf(now);
  const perIp = ipCounterId(eventId, ip, window);
  const perEvent = eventCounterId(eventId, window);

  if (!(await reserve(perIp, MAX_FAILURES_PER_IP, eventId, now))) return { result: 'locked' };
  if (!(await reserve(perEvent, MAX_FAILURES_PER_EVENT, eventId, now))) {
    await refund(perIp);
    return { result: 'locked' };
  }

  if (verifyPin(pin, hash)) {
    await Promise.all([refund(perIp), refund(perEvent)]);
    return { result: 'ok', tokenKey };
  }
  return { result: 'wrong' };
}

async function verify(request: Request, now: number): Promise<Result> {
  const eventId = (request.arguments?.eventId ?? '').toString();
  const pin = (request.arguments?.pin ?? '').toString();
  if (!eventId) return NOT_FOUND;
  // A malformed PIN cannot be right, so it is turned away without a hash or a
  // counter, with the same words a wrong one gets.
  const ip = request.identity?.sourceIp?.[0] ?? 'unknown';
  if (!isValidPin(pin)) return WRONG;

  const checked = await guardedCheck(eventId, pin, ip, now);
  if (checked.result === 'locked') return locked(now);
  if (checked.result === 'none') {
    // No PIN set (or no such event): nothing to unlock. One answer for both so
    // this cannot be used to find which event ids exist.
    return { ok: false, message: 'This gallery does not need a PIN.', pinSet: false };
  }
  if (checked.result !== 'ok') return WRONG;
  const { token, expiresAt } = signAccessToken(checked.tokenKey, eventId, now);
  return { ok: true, token, expiresAt, pinSet: true };
}

async function manage(request: Request, now: number): Promise<Result> {
  const eventId = (request.arguments?.eventId ?? '').toString();
  const action = (request.arguments?.action ?? '').toString();
  const pin = (request.arguments?.pin ?? '').toString();
  if (!eventId) return NOT_FOUND;

  const event = await getItem(EVENT_TABLE, eventId);
  if (!event || !mayManage(request.identity, event.owner?.S ?? '')) return NOT_FOUND;

  if (action === 'clear') {
    await dynamo.send(new DeleteItemCommand({ TableName: PIN_TABLE, Key: { id: { S: eventId } } }));
    await setPinFlag(eventId, false);
    return { ok: true, message: 'The PIN is off. Links and QR codes that carried it stop being needed.', pinSet: false };
  }

  if (action === 'set') {
    if (!isValidPin(pin)) return { ok: false, message: 'Use 4 to 6 digits.' };
    const nowIso = new Date(now).toISOString();
    // A new random key every time revokes every token and PIN link made before.
    const item: Record<string, AttributeValue> = {
      id: { S: eventId },
      eventId: { S: eventId },
      pinHash: { S: hashPin(pin) },
      tokenKey: { S: newTokenKey() },
      pinLength: { N: String(pin.length) },
      changedAt: { S: nowIso },
      createdAt: { S: nowIso },
      updatedAt: { S: nowIso },
      __typename: { S: 'GalleryPin' },
    };
    await dynamo.send(new PutItemCommand({ TableName: PIN_TABLE, Item: item }));
    await setPinFlag(eventId, true);
    return { ok: true, message: 'PIN saved.', pinSet: true };
  }

  if (action === 'check') {
    // Lets the host confirm the PIN they typed before a QR is made from it. It
    // shares the guess limits, so it is not a way around them.
    if (!isValidPin(pin)) return { ok: false, message: 'Use 4 to 6 digits.' };
    const ip = request.identity?.sourceIp?.[0] ?? 'unknown';
    const checked = await guardedCheck(eventId, pin, ip, now);
    if (checked.result === 'locked') return locked(now);
    if (checked.result === 'none') return { ok: false, message: 'No PIN is set yet.', pinSet: false };
    if (checked.result === 'wrong') return { ok: false, message: 'That is not the PIN you set.', pinSet: true };
    return { ok: true, message: 'That is your PIN.', pinSet: true };
  }

  return { ok: false, message: 'That action is not available.' };
}

export const handler = async (event: Request): Promise<Result> => {
  const field = event.info?.fieldName ?? event.fieldName ?? '';
  const now = Date.now();
  try {
    if (field === 'manageGalleryPin') return await manage(event, now);
    if (field === 'verifyGalleryPin') return await verify(event, now);
  } catch (error) {
    console.error('gallery-access failed', { field, error });
    return { ok: false, message: 'Something went wrong. Please try again.' };
  }
  return { ok: false, message: 'That action is not available.' };
};

