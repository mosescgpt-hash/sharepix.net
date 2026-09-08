// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { randomInt, randomUUID } from 'node:crypto';
import type { Schema } from '../../data/resource';
import {
  activationFor,
  codeUsable,
  eventCodeFrom,
  hostNameFrom,
  isCorporateStatusActive,
  isTrialTier,
  newEventRow,
  normalizeTier,
  ownerStringFor,
  planFor,
  type DiscountRow,
} from './newEvent';
import { normalizeSource } from './attribution';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CORPORATE_TABLE = process.env.CORPORATE_TABLE_NAME as string;
const DISCOUNT_TABLE = process.env.DISCOUNT_TABLE_NAME as string;
const HOST_PROFILE_TABLE = process.env.HOST_PROFILE_TABLE_NAME as string;
const FREE_CLAIM_TABLE = process.env.FREE_CLAIM_TABLE_NAME as string;

type Handler = Schema['createHostedEvent']['functionHandler'];

/** The host's saved display name, or '' — best-effort, it is only cosmetic. */
async function profileNameFor(sub: string): Promise<string> {
  if (!HOST_PROFILE_TABLE) return '';
  const found = await dynamo
    .send(new GetItemCommand({ TableName: HOST_PROFILE_TABLE, Key: { id: { S: sub } } }))
    .catch(() => null);
  return found?.Item?.displayName?.S ?? '';
}

/** Whether this host has a live Corporate subscription, read from their own row. */
async function corporateActiveFor(sub: string): Promise<boolean> {
  if (!CORPORATE_TABLE) return false;
  const found = await dynamo
    .send(new GetItemCommand({ TableName: CORPORATE_TABLE, Key: { userId: { S: sub } } }))
    .catch(() => null);
  return isCorporateStatusActive(found?.Item?.status?.S);
}

function readDiscountRow(item: Record<string, AttributeValue>): DiscountRow {
  return {
    code: item.code?.S ?? '',
    active: item.active?.BOOL === true,
    expiresAt: item.expiresAt?.S ?? '',
    usedCount: Number(item.usedCount?.N ?? '0'),
    maxUses: Number(item.maxUses?.N ?? '0'),
    unlimitedUses: item.unlimitedUses?.BOOL === true,
    appliesToScopes: item.appliesToScopes?.S ?? '',
    appliesToTier: item.appliesToTier?.S ?? '',
    discountType: item.discountType?.S ?? 'percent',
    percentOff: item.percentOff?.N != null ? Number(item.percentOff.N) : null,
    amountOffCents: item.amountOffCents?.N != null ? Number(item.amountOffCents.N) : null,
  };
}

async function discountRowFor(code: string): Promise<DiscountRow | null> {
  if (!DISCOUNT_TABLE || !code) return null;
  const found = await dynamo.send(
    new GetItemCommand({ TableName: DISCOUNT_TABLE, Key: { code: { S: code } } }),
  );
  return found.Item ? readDiscountRow(found.Item) : null;
}

/**
 * Spend one use of a code, atomically.
 *
 * The read above is only a pre-check: two requests can both see a code with one
 * use left. The conditional update is what actually settles it, and it repeats
 * every condition rather than trusting what was read — so a code that expired,
 * was deactivated, or ran out between the read and here loses here.
 *
 * This replaces the old `redeemDiscountCode` mutation, which any signed-in user
 * could call to burn a code's uses without ever creating anything.
 */
async function spendCode(code: string, nowISO: string): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: DISCOUNT_TABLE,
        Key: { code: { S: code } },
        UpdateExpression: 'ADD #usedCount :one SET #lastUsedAt = :now',
        ConditionExpression:
          '#active = :true AND #expiresAt > :now AND (#unlimited = :true OR #usedCount < #maxUses)',
        ExpressionAttributeNames: {
          '#usedCount': 'usedCount',
          '#lastUsedAt': 'lastUsedAt',
          '#active': 'active',
          '#expiresAt': 'expiresAt',
          '#maxUses': 'maxUses',
          '#unlimited': 'unlimitedUses',
        },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':now': { S: nowISO },
          ':true': { BOOL: true },
        },
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

/**
 * Write the event under a fresh id and a code nothing else holds.
 *
 * Event codes are six characters from a 31-letter alphabet — about 900 million
 * combinations — so a collision is vanishingly unlikely, but "unlikely" is not
 * "impossible" and two events sharing a code would send guests to the wrong
 * gallery. The conditional write makes a collision a retry rather than a
 * silent overwrite.
 */
/**
 * Take this account's one free event, or refuse.
 *
 * The row id is the host's Cognito sub, so this is a single-item conditional
 * put: two requests racing each other cannot both succeed, and a host cannot
 * get a second free event by clicking twice. The claim is never released on
 * success, so "one per account" means one ever rather than one at a time —
 * farming free storage by deleting the event and starting again is the whole
 * thing this is here to stop. An admin can delete the row to grant another.
 *
 * A missing table name refuses rather than allowing. Every other optional
 * table in this file degrades open because it is cosmetic or advisory; this
 * one is the limit itself, and a deploy that lost the environment variable
 * would otherwise hand out unlimited free events silently.
 */
async function claimFreeEvent(sub: string, eventId: string, nowISO: string): Promise<void> {
  if (!FREE_CLAIM_TABLE) {
    throw new Error('Free events are unavailable right now. Please try again later.');
  }
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: FREE_CLAIM_TABLE,
        Item: {
          id: { S: sub },
          __typename: { S: 'FreeEventClaim' },
          eventId: { S: eventId },
          claimedAt: { S: nowISO },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      throw new Error(
        'You have already used your free event. Create a paid event to run another.',
      );
    }
    throw err;
  }
}

/**
 * Give the claim back, for when the event it was claimed for could not be
 * written. Best-effort on purpose: if this delete fails the host has lost a
 * free event they never received, which an admin can restore, and throwing
 * here would replace a clear "could not create your event" with a confusing
 * second error about something the host never asked about.
 */
async function releaseFreeEvent(sub: string): Promise<void> {
  if (!FREE_CLAIM_TABLE) return;
  await dynamo
    .send(new DeleteItemCommand({ TableName: FREE_CLAIM_TABLE, Key: { id: { S: sub } } }))
    .catch(() => undefined);
}

async function putEvent(item: Record<string, AttributeValue>): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: EVENT_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );
}

export const handler: Handler = async (event) => {
  const identity = event.identity as
    | { sub?: string; username?: string; claims?: Record<string, unknown> }
    | undefined;
  const sub = (identity?.sub ?? '').trim();
  // Guests can't reach this mutation (it is authenticated-only), but an identity
  // without a sub would produce an unowned event nobody could ever manage.
  if (!sub) throw new Error('Sign in to create an event.');

  const owner = ownerStringFor(sub, identity?.username ?? '');
  const tier = normalizeTier(event.arguments.tier);
  if (!planFor(tier)) throw new Error('Choose one of the available plans.');

  // A corporate event costs nothing per event, so a code has nothing to take
  // off one — and checking it there would only produce a confusing "does not
  // apply to this plan" on a plan where it was never needed. The subscription
  // is the whole authorization for those. A free event is ignored for the same
  // reason plus a sharper one: applying a code to a $0 plan would spend a use
  // of it to discount nothing.
  const rawCode =
    tier === 'corporate' || isTrialTier(tier)
      ? ''
      : (event.arguments.discountCode ?? '').trim().toUpperCase();

  // Both of these are server state the request cannot influence: the caller's
  // own subscription row, and the code as the admin actually configured it.
  const [corporateActive, storedCode] = await Promise.all([
    tier === 'corporate' ? corporateActiveFor(sub) : Promise.resolve(false),
    rawCode ? discountRowFor(rawCode) : Promise.resolve(null),
  ]);

  const now = new Date();
  let discount: { row: DiscountRow; priceCents: number } | null = null;
  if (rawCode) {
    const check = codeUsable(storedCode, `event:${tier}`, now.getTime());
    if (!check.ok) throw new Error(check.reason);
    discount = { row: storedCode as DiscountRow, priceCents: planFor(tier)!.priceCents };
  }

  const activation = activationFor({ tier, corporateActive, discount });
  if (activation.kind === 'refused') throw new Error(activation.reason);
  const active = activation.kind === 'active';

  // Spend the code before the event exists, and only when it is what makes the
  // event free. A partial code is not spent here — it rides along to Stripe,
  // and the webhook counts it once the payment actually completes, so a host
  // who abandons checkout hasn't consumed a use.
  if (activation.kind === 'active' && activation.via === 'comped') {
    const spent = await spendCode(rawCode, now.toISOString());
    if (!spent) throw new Error('That discount code can no longer be used.');
  }

  const row = newEventRow({
    name: event.arguments.name ?? '',
    date: event.arguments.date,
    city: event.arguments.city,
    state: event.arguments.state,
    tier,
    hostName: hostNameFrom(
      await profileNameFor(sub),
      String(identity?.claims?.email ?? identity?.claims?.['cognito:username'] ?? ''),
    ),
    active,
    now,
  });

  const id = randomUUID();
  const nowISO = now.toISOString();
  const eventCode = eventCodeFrom((max) => randomInt(max));

  const item: Record<string, AttributeValue> = {
    id: { S: id },
    __typename: { S: 'Event' },
    owner: { S: owner },
    name: { S: row.name },
    eventCode: { S: eventCode },
    tier: { S: row.tier },
    accessExpiresAt: { S: row.accessExpiresAt },
    uploadWindowEndsAt: { S: row.uploadWindowEndsAt },
    paid: { BOOL: row.paid },
    createdBy: { S: row.createdBy },
    // Normalised against a closed set, never stored as sent. The value arrives
    // in the request, so an unrecognised one is quietly `direct` rather than
    // becoming free text in the admin dashboard and every later report.
    source: { S: normalizeSource(event.arguments.source) },
    createdAt: { S: nowISO },
    updatedAt: { S: nowISO },
  };
  if (row.date) item.date = { S: row.date };
  if (row.location) item.location = { S: row.location };
  // A missing limit means unlimited, which is what Premium and Corporate get —
  // so the attribute is left off rather than written as null.
  if (row.photoLimit !== null) item.photoLimit = { N: String(row.photoLimit) };
  if (row.videoLimit !== null) item.videoLimit = { N: String(row.videoLimit) };
  // Stamped like every other limit, so a later change to the budget cannot
  // retroactively shrink what this event was sold. entitledVideoBytes raises it
  // if the plan later becomes more generous.
  if (row.videoBytesLimit !== null) {
    item.videoBytesLimit = { N: String(row.videoBytesLimit) };
  }

  // Claim before writing, so two simultaneous requests cannot both produce a
  // free event; release if the write then fails, so a failed creation does not
  // silently burn the host's only free event. The gap between the two is one
  // PutItem: a crash inside it leaves a claim with no event, which an admin can
  // clear. Claiming afterwards instead would close that gap and open a much
  // worse one — the race itself.
  const trial = activation.kind === 'active' && activation.via === 'trial';
  if (trial) await claimFreeEvent(sub, id, nowISO);

  try {
    await putEvent(item);
  } catch (err) {
    if (trial) await releaseFreeEvent(sub);
    throw err;
  }

  return {
    id,
    name: row.name,
    eventCode,
    tier: row.tier,
    date: row.date,
    location: row.location,
    photoLimit: row.photoLimit,
    videoLimit: row.videoLimit,
    videoBytesLimit: row.videoBytesLimit,
    accessExpiresAt: row.accessExpiresAt,
    uploadWindowEndsAt: row.uploadWindowEndsAt,
    paid: row.paid,
    createdBy: row.createdBy,
    owner,
    createdAt: nowISO,
  };
};
