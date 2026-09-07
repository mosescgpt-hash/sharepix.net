// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { refundDecision, refundId, type LedgerRow } from './refunds';
import { PROMISE_VERSION, ATTESTATION_QUESTION, canFileClaim } from './guestUploadPromise';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PAYMENT_TABLE = process.env.PAYMENT_TABLE_NAME as string;
const REFUND_TABLE = process.env.REFUND_TABLE_NAME as string;

type Handler = Schema['claimGuestUploadPromise']['functionHandler'];

/** Bound what a host can type into a row an admin later reads. */
function cleanNote(value: string | null | undefined, maxLength = 500): string {
  let out = '';
  for (const char of value ?? '') {
    const code = char.codePointAt(0) ?? 0;
    // A character scan rather than a regex: the control-character class is the
    // single most reliably mis-escaped thing in this codebase.
    if (code === 10 || code === 9) {
      out += ' ';
      continue;
    }
    if (code < 32 || code === 127) continue;
    out += char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * What this event was actually paid, in cents.
 *
 * Summed from the Payment rows the Stripe webhook wrote, never from the tier
 * price and never from the request. The tier price is what the plan costs
 * today; this is what this customer handed over, which is the only number a
 * refund may be measured against — a repricing must not change what an old
 * event can get back.
 *
 * A scan rather than a query: Payment has no index on eventId, and this runs
 * once when a human files a claim rather than on any hot path.
 */
async function paidCentsFor(eventId: string): Promise<number> {
  if (!PAYMENT_TABLE) return 0;
  let total = 0;
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: PAYMENT_TABLE,
        ExclusiveStartKey: startKey,
        ProjectionExpression: 'eventId, amountTotal, #status',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    );
    for (const item of page.Items ?? []) {
      if (item.eventId?.S !== eventId) continue;
      // Only completed payments. A pending or failed session is not money we
      // hold, and refunding against one would return cash we never took.
      const status = (item.status?.S ?? '').toLowerCase();
      if (status && status !== 'complete' && status !== 'completed' && status !== 'paid') {
        continue;
      }
      total += Number(item.amountTotal?.N ?? '0');
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return Math.max(0, total);
}

/** Everything already committed back for this event. */
async function ledgerFor(eventId: string): Promise<LedgerRow[]> {
  if (!REFUND_TABLE) return [];
  const rows: LedgerRow[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: REFUND_TABLE,
        ExclusiveStartKey: startKey,
        ProjectionExpression: 'eventId, #status, amountCents',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    );
    for (const item of page.Items ?? []) {
      if (item.eventId?.S !== eventId) continue;
      rows.push({
        status: item.status?.S ?? null,
        amountCents: Number(item.amountCents?.N ?? '0'),
      });
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

export const handler: Handler = async (event) => {
  const identity = event.identity as { sub?: string; username?: string } | undefined;
  const sub = (identity?.sub ?? '').trim();
  if (!sub) throw new Error('Sign in to make a claim.');

  const eventId = (event.arguments.eventId ?? '').trim();
  if (!eventId || !REFUND_TABLE) {
    throw new Error('That event could not be found.');
  }

  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  const row = found?.Item;

  // Deliberately the same answer for "no such event" and "not yours", so this
  // cannot be used to discover which event ids exist.
  const owner = row?.owner?.S ?? '';
  if (!row || !owner.includes(sub)) {
    throw new Error('That event could not be found.');
  }

  // Every fact comes from the stored row. The request supplies the event id,
  // the attestation and a note, and nothing else that decides anything.
  const check = canFileClaim(
    {
      tier: row.tier?.S ?? null,
      paid: row.paid?.BOOL !== false,
      guestUploadCount: Number(row.guestUploadCount?.N ?? '0'),
      date: row.date?.S ?? null,
      createdAt: row.createdAt?.S ?? null,
    },
    event.arguments.attested === true,
  );
  if (!check.ok) throw new Error(check.message);

  const paidCents = await paidCentsFor(eventId);
  const ledger = await ledgerFor(eventId);
  // The full purchase price, capped by whatever has already gone back.
  const decision = refundDecision(paidCents, paidCents, ledger);
  if (!decision.allowed) throw new Error(decision.reason);

  const now = new Date().toISOString();
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: REFUND_TABLE,
        Item: {
          id: { S: refundId(eventId, 'GUEST_UPLOAD_PROMISE') },
          __typename: { S: 'Refund' },
          eventId: { S: eventId },
          customer: { S: owner },
          reason: { S: 'GUEST_UPLOAD_PROMISE' },
          status: { S: 'REQUESTED' },
          amountCents: { N: String(decision.amountCents) },
          attestation: { S: ATTESTATION_QUESTION },
          hostNote: { S: cleanNote(event.arguments.note) },
          promiseVersion: { S: PROMISE_VERSION },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        // One claim per event per reason. A second attempt is the same claim,
        // not a second obligation.
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      // Not an error worth alarming them with: they already asked.
      return {
        filed: true,
        message:
          'You have already made a claim for this event. We will be in touch — there is nothing more to do.',
      };
    }
    throw error;
  }

  return {
    filed: true,
    message:
      'Thanks — your claim is in. We review these by hand and refund to the card you paid with, so it may take a few days.',
  };
};
