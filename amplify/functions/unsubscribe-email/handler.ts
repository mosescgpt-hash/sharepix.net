// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { timingSafeEqual } from 'node:crypto';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const PREFERENCE_TABLE = process.env.PREFERENCE_TABLE_NAME as string;

type Handler = Schema['unsubscribeEmail']['functionHandler'];

/**
 * Deliberately the same answer for a wrong token, an unknown address and a
 * malformed one.
 *
 * Distinguishing them would turn this into an oracle for whether a given email
 * address is a SharePix customer, which is exactly the kind of thing an
 * unauthenticated endpoint should never tell anyone.
 */
const REFUSED = 'That unsubscribe link is not valid. It may have expired.';

/** Constant-time compare, so the token cannot be recovered a byte at a time. */
function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Mirrors preferenceKey in lib/emailPreferences.ts. */
function preferenceKey(email: string): string {
  const cleaned = (email ?? '').trim().toLowerCase();
  if (!cleaned || !cleaned.includes('@') || cleaned.length > 254) return '';
  for (const char of cleaned) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 32 || code === 127) return '';
  }
  return cleaned;
}

export const handler: Handler = async (event) => {
  const key = preferenceKey(event.arguments.email ?? '');
  const token = (event.arguments.token ?? '').trim();
  if (!key || !token || !PREFERENCE_TABLE) {
    throw new Error(REFUSED);
  }

  const found = await dynamo
    .send(new GetItemCommand({ TableName: PREFERENCE_TABLE, Key: { id: { S: key } } }))
    .catch(() => null);

  const stored = found?.Item?.unsubscribeToken?.S ?? '';
  if (!tokensMatch(stored, token)) {
    throw new Error(REFUSED);
  }

  const now = new Date().toISOString();
  // Idempotent on purpose: a mail client that pre-fetches the link, or someone
  // clicking twice, must not produce an error page for an action that already
  // succeeded. Re-stamping the date is harmless and simpler than a condition.
  await dynamo.send(
    new UpdateItemCommand({
      TableName: PREFERENCE_TABLE,
      Key: { id: { S: key } },
      UpdateExpression: 'SET unsubscribedAt = :now, updatedAt = :now',
      ExpressionAttributeValues: { ':now': { S: now } },
    }),
  );

  return {
    // Never echo the address back. The page already knows it, and a reflected
    // value is one more thing that could end up in a log or a referrer.
    unsubscribed: true,
    message:
      'You will no longer receive optional emails from SharePix. You will still get messages about your own events, such as a warning before a gallery closes.',
  };
};
