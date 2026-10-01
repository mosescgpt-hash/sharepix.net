import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { CORPORATE_INCLUDED_EVENTS } from './priceList';

const dynamo = new DynamoDBClient({});
const QUOTA_TABLE = process.env.QUOTA_TABLE_NAME ?? '';

type Handler = Schema['myCorporateSeats']['functionHandler'];

/**
 * How many of this month's included Corporate events the caller has used.
 *
 * Reads the same `corporate-month#<sub>#<YYYY-MM>` row create-event counts
 * against, by key, for the caller's own sub only — the sub comes from the
 * verified token, so nobody can ask about another account. The allowance
 * resets at the start of each UTC calendar month, which is `resetsAt`.
 */
export const handler: Handler = async (event) => {
  const sub = ((event.identity as { sub?: string } | null | undefined)?.sub ?? '').trim();
  if (!sub) throw new Error('You must be signed in.');

  const now = new Date();
  const included = CORPORATE_INCLUDED_EVENTS;
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  if (!QUOTA_TABLE) return { included, used: 0, resetsAt };

  const found = await dynamo.send(
    new GetItemCommand({
      TableName: QUOTA_TABLE,
      Key: { id: { S: `corporate-month#${sub}#${now.toISOString().slice(0, 7)}` } },
      ProjectionExpression: '#count',
      ExpressionAttributeNames: { '#count': 'count' },
    }),
  );
  const used = Math.max(0, Number(found.Item?.count?.N ?? '0') || 0);
  return { included, used, resetsAt };
};
