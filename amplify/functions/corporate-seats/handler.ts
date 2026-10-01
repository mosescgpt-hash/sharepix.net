import { BatchGetItemCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { CORPORATE_INCLUDED_EVENTS } from './priceList';

const dynamo = new DynamoDBClient({});
const QUOTA_TABLE = process.env.QUOTA_TABLE_NAME ?? '';

type Handler = Schema['myCorporateSeats']['functionHandler'];

/**
 * How many of the caller's included Corporate event slots are taken.
 *
 * Reads the same `corporate-seat#<sub>#<n>` rows create-event writes, by key,
 * for the caller's own sub only — the sub comes from the verified token, so
 * nobody can ask about another account. A seat is in use while its event's
 * upload window is still open, which is exactly the rule create-event applies
 * when it decides whether a seat is free.
 */
export const handler: Handler = async (event) => {
  const sub = ((event.identity as { sub?: string } | null | undefined)?.sub ?? '').trim();
  if (!sub) throw new Error('You must be signed in.');

  const included = CORPORATE_INCLUDED_EVENTS;
  if (!QUOTA_TABLE) return { included, inUse: 0, nextFreeAt: null };

  const keys = Array.from({ length: included }, (_, n) => ({
    id: { S: `corporate-seat#${sub}#${n}` },
  }));
  const found = await dynamo.send(
    new BatchGetItemCommand({
      RequestItems: {
        [QUOTA_TABLE]: { Keys: keys, ProjectionExpression: 'id, expiresAt' },
      },
    }),
  );

  const now = Date.now();
  const busyUntil = (found.Responses?.[QUOTA_TABLE] ?? [])
    .map((item) => Date.parse(item.expiresAt?.S ?? ''))
    .filter((ends) => Number.isFinite(ends) && ends > now)
    .sort((a, b) => a - b);

  return {
    included,
    inUse: busyUntil.length,
    // Only worth saying when every slot is taken: it is when the next event
    // stops costing an extra.
    nextFreeAt:
      busyUntil.length >= included && busyUntil[0] ? new Date(busyUntil[0]).toISOString() : null,
  };
};
