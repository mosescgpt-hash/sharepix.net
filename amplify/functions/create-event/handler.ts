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
import { analyticsId, type AnalyticsEventName } from './analytics';
import { CORPORATE_INCLUDED_EVENTS } from './priceList';
import {
  CURRENT_TRIAL_TIER,
  activationFor,
  codeUsable,
  eventCodeFrom,
  hostNameFrom,
  isCorporateStatusActive,
  isTrialTier,
  newEventRow,
  normalizeEventType,
  normalizeTier,
  ownerStringFor,
  planFor,
  type DiscountRow,
} from './newEvent';
import { normalizeSource } from './attribution';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME ?? '';
const CORPORATE_TABLE = process.env.CORPORATE_TABLE_NAME as string;
const DISCOUNT_TABLE = process.env.DISCOUNT_TABLE_NAME as string;
const HOST_PROFILE_TABLE = process.env.HOST_PROFILE_TABLE_NAME as string;
const FREE_CLAIM_TABLE = process.env.FREE_CLAIM_TABLE_NAME as string;
const QUOTA_TABLE = process.env.QUOTA_TABLE_NAME as string;

/**
 * New free events the whole platform hands out per UTC day.
 *
 * The per-account claim stops one person farming free events; it does not stop
 * someone with a script and a supply of email addresses, because every new
 * account is a new claim. This is the throttle on that: whatever the number of
 * accounts, free storage can only be created this fast.
 *
 * The number is a setting, not a constant: a global admin changes it on the
 * dashboard (AppSetting `free-events-per-day`), next to a chart of how close
 * each day came to it. FREE_EVENTS_PER_DAY in the environment is only the
 * fallback for when no setting has been saved, and 25 is the fallback for that.
 * 0 is allowed and means free events are paused.
 */
const DEFAULT_FREE_EVENTS_PER_DAY = 25;
const MAX_FREE_EVENTS_PER_DAY = 1000;
const FREE_EVENTS_SETTING_KEY = 'free-events-per-day';
const SETTING_TABLE = process.env.SETTING_TABLE_NAME ?? '';

/** A whole number from 0 to the maximum, or null for anything else. */
function parseDailyLimit(raw: string | undefined | null): number | null {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value <= MAX_FREE_EVENTS_PER_DAY ? value : null;
}

/**
 * Today's limit: the admin's setting, else the environment, else the default.
 *
 * Read on every free-event request rather than cached, so a change on the
 * dashboard applies to the very next one. It is one small GetItem on a path
 * that runs a handful of times a day. A setting that cannot be read falls
 * back rather than refusing: the fallback is still a limit.
 */
async function freeEventsPerDay(): Promise<number> {
  if (SETTING_TABLE) {
    const found = await dynamo
      .send(
        new GetItemCommand({
          TableName: SETTING_TABLE,
          Key: { id: { S: FREE_EVENTS_SETTING_KEY } },
        }),
      )
      .catch(() => null);
    const saved = parseDailyLimit(found?.Item?.value?.S);
    if (saved !== null) return saved;
  }
  return parseDailyLimit(process.env.FREE_EVENTS_PER_DAY) ?? DEFAULT_FREE_EVENTS_PER_DAY;
}

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
 * Take one of today's free events from the platform-wide allowance, or refuse.
 *
 * One conditional update on a single counter row per UTC day, so concurrent
 * requests cannot both take the last one. Like the account claim, a missing
 * table refuses: this is a limit, and a limit that disappears with an
 * environment variable is not one.
 */
async function takeTrialAllowance(nowISO: string): Promise<void> {
  if (!QUOTA_TABLE) {
    throw new Error('Free events are unavailable right now. Please try again later.');
  }
  const cap = await freeEventsPerDay();
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: trialDayKey(nowISO) } },
        UpdateExpression:
          // The cap is written onto the row too, so the dashboard chart shows
          // the limit each day actually ran under, not today's setting.
          'ADD #count :one SET #typename = if_not_exists(#typename, :typename), #limit = :cap, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :cap',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#limit': 'limit',
          '#typename': '__typename',
        },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':cap': { N: String(cap) },
          ':now': { S: nowISO },
          ':typename': { S: 'QuotaCounter' },
        },
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      await countRefusal(nowISO, cap);
      if (cap === 0) {
        throw new Error('Free events are paused right now. You can create a paid event at any time.');
      }
      throw new Error(
        'Today’s free events have all been claimed. Please try again tomorrow, or create a paid event now.',
      );
    }
    throw err;
  }
}

/**
 * Count a request the limit turned away, on the same day's row.
 *
 * This is the number that says whether the limit is too low: "25 of 25" only
 * says the day filled up, not whether three people or three hundred were
 * waiting behind it. Unconditional and best-effort — it is telemetry about a
 * refusal that has already happened.
 */
async function countRefusal(nowISO: string, cap: number): Promise<void> {
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: trialDayKey(nowISO) } },
        UpdateExpression:
          'ADD #refused :one SET #typename = if_not_exists(#typename, :typename), #limit = :cap, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
        ExpressionAttributeNames: {
          '#refused': 'refused',
          '#limit': 'limit',
          '#typename': '__typename',
        },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':cap': { N: String(cap) },
          ':now': { S: nowISO },
          ':typename': { S: 'QuotaCounter' },
        },
      }),
    )
    .catch(() => undefined);
}

function trialDayKey(nowISO: string): string {
  return `trial-day#${nowISO.slice(0, 10)}`;
}

/** Give today's allowance back. Best-effort, for the same reason as below. */
async function releaseTrialAllowance(nowISO: string): Promise<void> {
  if (!QUOTA_TABLE) return;
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: trialDayKey(nowISO) } },
        UpdateExpression: 'ADD #count :neg',
        ConditionExpression: '#count > :zero',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':neg': { N: '-1' }, ':zero': { N: '0' } },
      }),
    )
    .catch(() => undefined);
}

/** The counter row for one subscriber's included events in one UTC month. */
function corporateMonthKey(sub: string, nowISO: string): string {
  return `corporate-month#${sub}#${nowISO.slice(0, 7)}`;
}

/**
 * Count one of this month's included Corporate events, or report that the
 * month's allowance is used up.
 *
 * One conditional increment on a single row per subscriber per UTC calendar
 * month, so two requests racing for the last included event cannot both get
 * it. A new month is a new row, so the allowance resets on the 1st with no
 * job to run. There is no limit on how many events run at once.
 *
 * A missing table returns false rather than counting the event as included:
 * the subscriber is then offered it as an extra event at checkout, which is a
 * worse experience than a free one but never an event the subscription did
 * not cover.
 */
async function takeCorporateMonthly(sub: string, nowISO: string): Promise<boolean> {
  if (!QUOTA_TABLE) {
    console.error('QUOTA_TABLE_NAME is not set; the Corporate allowance cannot be checked');
    return false;
  }
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: corporateMonthKey(sub, nowISO) } },
        UpdateExpression:
          'ADD #count :one SET #typename = if_not_exists(#typename, :typename), #limit = :cap, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :cap',
        ExpressionAttributeNames: {
          '#count': 'count',
          '#limit': 'limit',
          '#typename': '__typename',
        },
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':cap': { N: String(CORPORATE_INCLUDED_EVENTS) },
          ':now': { S: nowISO },
          ':typename': { S: 'QuotaCounter' },
        },
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/** Give this month's included event back when the event could not be written. */
async function releaseCorporateMonthly(sub: string, nowISO: string): Promise<void> {
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: QUOTA_TABLE,
        Key: { id: { S: corporateMonthKey(sub, nowISO) } },
        UpdateExpression: 'ADD #count :neg',
        ConditionExpression: '#count > :zero',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: { ':neg': { N: '-1' }, ':zero': { N: '0' } },
      }),
    )
    .catch(() => undefined);
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

/**
 * Write one funnel event, once.
 *
 * The id carries the dedupe rule, so a milestone written twice is a conditional
 * -put failure rather than a second row. Failures are swallowed: this is
 * telemetry hanging off something that already succeeded, and nothing a
 * customer is waiting for should fail because a counter could not be written.
 */
async function fireAnalytics(
  name: AnalyticsEventName,
  scopeId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!ANALYTICS_TABLE) return;
  const now = new Date().toISOString();
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: ANALYTICS_TABLE,
        Item: {
          id: { S: analyticsId(name, scopeId, randomUUID()) },
          __typename: { S: 'AnalyticsEvent' },
          name: { S: name },
          scopeId: { S: scopeId },
          ...(detail ? { detailJson: { S: JSON.stringify(detail).slice(0, 500) } } : {}),
          occurredAt: { S: now },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return;
    console.error('Could not record a funnel event', {
      at: now,
      name,
      scopeId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
  // `free` is the retired trial. A bookmarked or cached ?tier=free link still
  // means "the free event", so it is read as the current one rather than
  // refused.
  const requested = normalizeTier(event.arguments.tier);
  const tier = requested === 'free' ? CURRENT_TRIAL_TIER : requested;
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

  let activation = activationFor({ tier, corporateActive, discount });
  if (activation.kind === 'refused') throw new Error(activation.reason);

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
    active: activation.kind === 'active',
    now,
  });

  const id = randomUUID();
  const nowISO = now.toISOString();

  // A corporate event counts against this month's included events. Past them
  // it is still created, unpaid, and the host pays for it as an extra event —
  // the same checkout and the same webhook a single event uses.
  let corporateCounted = false;
  if (activation.kind === 'active' && activation.via === 'corporate') {
    corporateCounted = await takeCorporateMonthly(sub, nowISO);
    if (!corporateCounted) {
      activation = activationFor({
        tier,
        corporateActive,
        corporateIncluded: false,
        discount,
      });
      row.paid = false;
    }
  }
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
  // Who the QR signs will be addressed to. Normalised against the two answers
  // and otherwise left off — an unrecognised value means the event is worded
  // the way every event was before the question existed, which is the right
  // fallback and never an error worth failing a paid creation over.
  {
    const audience = String(event.arguments.uploadAudience ?? '').trim().toLowerCase();
    if (audience === 'guests' || audience === 'host-only') {
      item.uploadAudience = { S: audience };
    }
  }
  // Wedding, birthday and so on — a closed set, or left off.
  {
    const eventType = normalizeEventType(event.arguments.eventType);
    if (eventType) item.eventType = { S: eventType };
  }
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
  //
  // The account claim goes first and the day's allowance second: a host
  // refused by the daily limit gets their claim back and can try tomorrow,
  // where the other order would spend the platform's allowance on somebody
  // who already had their free event.
  if (trial) {
    await claimFreeEvent(sub, id, nowISO);
    try {
      await takeTrialAllowance(nowISO);
    } catch (err) {
      await releaseFreeEvent(sub);
      throw err;
    }
  }

  try {
    await putEvent(item);
  } catch (err) {
    if (trial) {
      await releaseFreeEvent(sub);
      await releaseTrialAllowance(nowISO);
    }
    if (corporateCounted) await releaseCorporateMonthly(sub, nowISO);
    throw err;
  }

  // The funnel's Create stage, from the one place that knows an event was
  // actually written. Not awaited into the response: a host who has an event
  // must not be made to wait on telemetry, or fail because of it.
  void fireAnalytics('event_created', id, { tier: row.tier, trial });

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
