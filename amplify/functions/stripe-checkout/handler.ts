import Stripe from 'stripe';
import { pricingSourceFor } from './pricing';
// @ts-ignore -- @aws-sdk/* is provided by the Lambda runtime, not installed as a dep.
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { effectiveAmountOffCents, distributeDiscount } from './discount-math';

type Handler = Schema['createCheckoutSession']['functionHandler'];

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const DISCOUNT_TABLE = process.env.DISCOUNT_TABLE_NAME as string;

// The guest-download add-on is only sold on Premium and Corporate events — the
// plans that can actually use guest downloads / the download-sharing QR. Read
// the event's tier server-side so a Starter/Standard event can't buy it by
// bypassing the UI gate.
async function eventTier(eventId: string): Promise<string> {
  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  return (found.Item?.tier?.S ?? '').toLowerCase();
}

/**
 * The fields of an event's row that decide what it costs and who may pay.
 * The decision itself is in ./pricing, where it is tested.
 */
async function eventRowFor(eventId: string): Promise<{ tier: string; owner: string } | null> {
  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  if (!found.Item) return null;
  return {
    tier: (found.Item.tier?.S ?? '').toLowerCase(),
    owner: found.Item.owner?.S ?? '',
  };
}

// Validate a caller-supplied discount code against the DiscountCode table and
// return how much it takes off (1–100), or null when no code was supplied. The
// code, its expiry, remaining uses, and scope are all checked server-side — a
// crafted request can't apply a discount the admin didn't authorize. Throws a
// guest-facing message when a code was supplied but can't be used.
async function resolveDiscount(
  rawCode: string | null | undefined,
  scopes: string[],
): Promise<{
  code: string;
  discountType: 'percent' | 'amount';
  percentOff: number;
  amountOffCents: number;
  duration: 'once' | 'forever';
  /** Which of the requested scopes this code actually applies to. */
  coveredScopes: string[];
} | null> {
  const code = (rawCode ?? '').trim().toUpperCase();
  if (!code) return null;

  const found = await dynamo.send(
    new GetItemCommand({ TableName: DISCOUNT_TABLE, Key: { code: { S: code } } }),
  );
  const item = found.Item;
  if (!item) throw new Error('That discount code is not valid.');
  if (item.active?.BOOL !== true) throw new Error('That discount code is no longer active.');

  const expiresAt = item.expiresAt?.S ?? '';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw new Error('That discount code has expired.');
  }

  // An unlimited code has no ceiling — usedCount still counts up so redemptions
  // can be measured. Anything else must have uses remaining.
  const usedCount = Number(item.usedCount?.N ?? '0');
  const maxUses = Number(item.maxUses?.N ?? '0');
  if (item.unlimitedUses?.BOOL !== true && usedCount >= maxUses) {
    throw new Error('That discount code has no uses left.');
  }

  // Scope check. New codes carry appliesToScopes: a comma-separated list of the
  // paid items ticked when the code was made — event:starter, event:standard,
  // event:premium, corporate, extend, live_slideshow, guest_book. ('all' is
  // still honored for codes made before plans were listed individually.) This
  // matching is generic, so a new add-on key works as soon as an admin can tick
  // it. Legacy codes have
  // only appliesToTier, where 'all'/blank was universal and a specific tier only
  // ever applied to creating an event on that plan.
  const scopesRaw = (item.appliesToScopes?.S ?? '').toLowerCase().trim();
  const entries = scopesRaw ? scopesRaw.split(',').map((entry) => entry.trim()) : [];
  const legacyTier = (item.appliesToTier?.S ?? '').toLowerCase();

  const covers = (scope: string): boolean => {
    if (scopesRaw) {
      return (
        scopesRaw === 'all' ||
        entries.includes(scope) ||
        // A pre-split 'event' scope covers every event plan.
        (scope.startsWith('event:') && entries.includes('event'))
      );
    }
    // Legacy codes carry only appliesToTier: 'all'/blank was universal, a
    // specific tier only ever applied to creating an event on that plan.
    return legacyTier === '' || legacyTier === 'all' ? true : scope === `event:${legacyTier}`;
  };

  // Report which of the requested items this code covers rather than rejecting
  // a partial match. A single-item purchase treats "covers nothing" as an error;
  // a mixed cart discounts only the covered lines.
  const coveredScopes = scopes.filter((scope) => covers(scope));
  if (coveredScopes.length === 0) {
    throw new Error('That discount code does not apply to this purchase.');
  }

  // A code is either a percentage or a fixed dollar amount. Missing type means
  // percent, so legacy codes are unchanged.
  const discountType = item.discountType?.S === 'amount' ? 'amount' : 'percent';
  // A missing percentOff (legacy codes) means a fully comped, free purchase.
  const percentOff = item.percentOff?.N != null ? Number(item.percentOff.N) : 100;
  const amountOffCents = item.amountOffCents?.N != null ? Number(item.amountOffCents.N) : 0;

  if (discountType === 'amount') {
    if (!(amountOffCents >= 1)) throw new Error('That discount code is misconfigured.');
  } else if (!(percentOff >= 1 && percentOff <= 100)) {
    throw new Error('That discount code is misconfigured.');
  }
  // Recurring duration matters only for the Corporate subscription: 'forever'
  // discounts every month, 'once' (the default) only the first. Anything else is
  // treated as 'once'.
  const duration = item.recurringDuration?.S === 'forever' ? 'forever' : 'once';
  return { code, discountType, percentOff, amountOffCents, duration, coveredScopes };
}

// Reuse one Stripe coupon per (kind, value, duration), creating it on first use.
// The id encodes all three so a "50% forever" and a "50% once" — or a "$50 off"
// and a "50% off" — never collide. Percentage once-coupons keep their original
// SPX-PCT-{n} id, so coupons already created stay in use.
async function couponFor(
  stripe: Stripe,
  discount: { discountType: 'percent' | 'amount'; percentOff: number; amountOffCents: number },
  duration: 'once' | 'forever',
): Promise<string> {
  const suffix = duration === 'forever' ? '-FOREVER' : '';
  const isAmount = discount.discountType === 'amount';
  const id = isAmount
    ? `SPX-AMT-${discount.amountOffCents}${suffix}`
    : `SPX-PCT-${discount.percentOff}${suffix}`;

  try {
    await stripe.coupons.retrieve(id);
  } catch {
    const label = isAmount
      ? `$${(discount.amountOffCents / 100).toFixed(2)} off`
      : `${discount.percentOff}% off`;
    try {
      await stripe.coupons.create({
        id,
        duration,
        name: `SharePix ${label}${duration === 'forever' ? ' (recurring)' : ''}`,
        // A fixed amount needs a currency; percentages must not carry one.
        ...(isAmount
          ? { amount_off: discount.amountOffCents, currency: 'usd' }
          : { percent_off: discount.percentOff }),
      });
    } catch (error) {
      // A concurrent request may have created it between our retrieve and create.
      const message = error instanceof Error ? error.message : String(error);
      if (!/already exists/i.test(message)) throw error;
    }
  }
  return id;
}

// Build the Stripe `discounts` array and the metadata that lets the webhook
// count the redemption, for a given code + tier. Returns empty pieces when no
// code was supplied.
async function buildDiscount(
  stripe: Stripe,
  rawCode: string | null | undefined,
  scopes: string[],
  baseAmountCents: number,
): Promise<{ discounts?: { coupon: string }[]; metadata: Record<string, string> }> {
  const resolved = await resolveDiscount(rawCode, scopes);
  if (!resolved) return { metadata: {} };

  // A fixed amount is measured against this purchase's price: capped so the
  // total can't go negative, and rounded up to cover the lot when what's left
  // would be too small for Stripe to charge.
  let discount = resolved;
  if (resolved.discountType === 'amount') {
    const effective = effectiveAmountOffCents(resolved.amountOffCents, baseAmountCents);
    if (effective <= 0) return { metadata: { discountCode: resolved.code } };
    discount = { ...resolved, amountOffCents: effective };
  }

  const coupon = await couponFor(stripe, discount, resolved.duration);
  return { discounts: [{ coupon }], metadata: { discountCode: resolved.code } };
}

// Prices mirror lib/pricing.ts (dollars → cents). Kept in sync by hand so the
// function has no cross-bundle imports.
// Mirrors PRICING_TIERS in lib/pricing.ts (dollars -> cents). These two lists
// MUST move together: this one is what Stripe actually charges, the other is
// what the site advertises, and a mismatch bills a price nobody was shown.
/**
 * What each plan costs, in cents. Mirrors PRICING_TIERS + RETIRED_TIERS in
 * lib/pricing.ts by hand, because Amplify functions cannot import from lib/.
 *
 * RETIRED PLANS STAY IN THIS MAP. It prices upload-window extensions as well as
 * new checkouts (`TIER_PRICING[extTier]`), so removing a retired tier would
 * stop every event already sold on it from being able to extend — something
 * those hosts paid for. What retires a plan is SELLABLE_TIERS below, not this.
 */
const TIER_PRICING: Record<string, { name: string; amount: number }> = {
  event: { name: 'SharePix Event', amount: 3900 },
  plus: { name: 'SharePix Plus event', amount: 6900 },
  // Retired — priced, not sold.
  starter: { name: 'SharePix Starter event', amount: 1900 },
  standard: { name: 'SharePix Standard event', amount: 3900 },
  premium: { name: 'SharePix Premium event', amount: 7900 },
};

/** The plans a NEW purchase may name. Mirrors PRICING_TIERS in lib/pricing.ts. */
const SELLABLE_TIERS = new Set(['event', 'plus']);

/**
 * Plans that already include these, so the add-on must never be sold twice.
 * Mirror GUEST_BOOK_INCLUDED_TIERS in lib/guestBook.ts and
 * LIVE_SLIDESHOW_INCLUDED_TIERS in lib/pricing.ts.
 */
const GUEST_BOOK_INCLUDED = new Set(['plus', 'premium', 'corporate']);
const LIVE_SLIDESHOW_INCLUDED = new Set(['plus', 'corporate']);

// Mirrors LIVE_SLIDESHOW_ADDON_PRICE in lib/pricing.ts (dollars → cents).
const LIVE_SLIDESHOW_ADDON_CENTS = 2900;
// Mirrors GUEST_BOOK_ADDON_PRICE in lib/pricing.ts.
const GUEST_BOOK_ADDON_CENTS = 1900;

export const handler: Handler = async (event) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing.');
  }
  if (!secretKey.startsWith('sk_')) {
    throw new Error(
      'STRIPE_SECRET_KEY does not look like a secret key (it should start with "sk_"). Check that the secret key — not the publishable key — was saved.',
    );
  }

  const appBaseUrl = process.env.APP_URL ?? 'https://www.sharepix.net';

  // Corporate: a recurring $149/month subscription rather than a one-time event
  // payment. We stamp the caller's id (and owner string) into metadata so the
  // webhook can attach the subscription to their account.
  if ((event.arguments.kind ?? '') === 'corporate') {
    const identity = event.identity as
      | { sub?: string; username?: string; claims?: { email?: string } }
      | undefined;
    const sub = identity?.sub;
    if (!sub) {
      throw new Error('You must be signed in to subscribe.');
    }
    const owner = `${sub}::${identity?.username ?? ''}`;
    const email = identity?.claims?.email;
    const metadata = { kind: 'corporate', userId: sub, owner };
    try {
      const stripe = new Stripe(secretKey);
      const disc = await buildDiscount(stripe, event.arguments.discountCode, ['corporate'], 14900);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email || undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: 14900,
              recurring: { interval: 'month' },
              product_data: { name: 'SharePix Corporate (monthly)' },
            },
          },
        ],
        success_url: `${appBaseUrl}/corporate?subscribed=1`,
        cancel_url: `${appBaseUrl}/corporate?checkout=cancelled`,
        metadata: { ...metadata, ...disc.metadata },
        subscription_data: { metadata },
        discounts: disc.discounts,
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Stripe subscription checkout failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Extend upload window: a one-time charge (half the plan price) that pushes the
  // event's 30-day upload window out by 30 more days. The webhook does the math.
  if ((event.arguments.kind ?? '') === 'extend_window') {
    const extEventId = event.arguments.eventId ?? '';
    if (!extEventId) throw new Error('Missing event for the extension.');
    const extTier = (event.arguments.tier ?? '').toLowerCase();
    const planPrice = TIER_PRICING[extTier]?.amount;
    if (!planPrice) throw new Error('Unknown plan for the extension.');
    const amount = Math.max(100, Math.round(planPrice / 2)); // half price, min $1
    try {
      const stripe = new Stripe(secretKey);
      const disc = await buildDiscount(stripe, event.arguments.discountCode, ['extend'], amount);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: { name: 'SharePix upload-window extension (+30 days)' },
            },
          },
        ],
        success_url: `${appBaseUrl}/event/${extEventId}/admin?extend=1`,
        cancel_url: `${appBaseUrl}/event/${extEventId}/admin?extend=cancelled`,
        metadata: { kind: 'extend_window', eventId: extEventId, ...disc.metadata },
        discounts: disc.discounts,
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Stripe extension checkout failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Live-slideshow add-on: a one-time charge that turns on the venue screen for
  // a single event. Sold on every plan (unlike guest downloads), so there's no
  // tier gate here. The webhook flips the event's liveSlideshowEnabled flag.
  if ((event.arguments.kind ?? '') === 'live_slideshow') {
    const showEventId = event.arguments.eventId ?? '';
    if (!showEventId) throw new Error('Missing event for the live slideshow.');
    try {
      const stripe = new Stripe(secretKey);
      const disc = await buildDiscount(stripe, event.arguments.discountCode, ['live_slideshow'], LIVE_SLIDESHOW_ADDON_CENTS);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: LIVE_SLIDESHOW_ADDON_CENTS,
              product_data: { name: 'SharePix live slideshow (one event)' },
            },
          },
        ],
        success_url: `${appBaseUrl}/event/${showEventId}/admin?addon=liveslideshow`,
        cancel_url: `${appBaseUrl}/event/${showEventId}/admin?addon=cancelled`,
        metadata: { kind: 'live_slideshow', eventId: showEventId, ...disc.metadata },
        discounts: disc.discounts,
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Stripe slideshow checkout failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Several per-event add-ons bought together as one checkout, so the host picks
  // what they want and pays once. Each selection is re-derived and re-priced
  // here from the event's own record — the client only says which keys it wants,
  // never what they cost or whether it's allowed to buy them.
  if ((event.arguments.kind ?? '') === 'addons') {
    const addonEventId = event.arguments.eventId ?? '';
    if (!addonEventId) throw new Error('Missing event for the add-ons.');

    const requested = [
      ...new Set(
        (event.arguments.addons ?? '')
          .split(',')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (requested.length === 0) throw new Error('Choose at least one add-on.');

    const found = await dynamo.send(
      new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: addonEventId } } }),
    );
    const ev = found.Item;
    if (!ev) throw new Error('This event no longer exists.');
    const evTier = (ev.tier?.S ?? '').toLowerCase();

    const lineItems: {
      quantity: number;
      price_data: {
        currency: string;
        unit_amount: number;
        product_data: { name: string };
      };
    }[] = [];
    const scopes: string[] = [];

    for (const key of requested) {
      if (key === 'extend') {
        const planPrice = TIER_PRICING[evTier]?.amount;
        if (!planPrice) throw new Error('This plan cannot be extended.');
        const amount = Math.max(100, Math.round(planPrice / 2));
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount,
            product_data: { name: 'SharePix upload-window extension (+30 days)' },
          },
        });
        scopes.push('extend');
      } else if (key === 'live_slideshow') {
        // Plus and Corporate include it; an event that already bought it must
        // never be sold it twice. Both re-derived from the event's own row.
        if (LIVE_SLIDESHOW_INCLUDED.has(evTier)) continue;
        if (ev.liveSlideshowEnabled?.BOOL === true) continue;
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: LIVE_SLIDESHOW_ADDON_CENTS,
            product_data: { name: 'SharePix live slideshow (one event)' },
          },
        });
        scopes.push('live_slideshow');
      } else if (key === 'guest_book') {
        // Plus, Premium and Corporate already include it, and an event that
        // has bought it must never be sold it twice. Both are re-derived from
        // the event's own row - the client says which key it wants, never
        // whether it is entitled to it. Skipped rather than rejected, so one
        // already-covered selection does not fail the whole cart.
        if (GUEST_BOOK_INCLUDED.has(evTier)) continue;
        if (ev.guestBookEnabled?.BOOL === true) continue;
        lineItems.push({
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: GUEST_BOOK_ADDON_CENTS,
            product_data: { name: 'SharePix guest book (one event)' },
          },
        });
        scopes.push('guest_book');
      } else {
        throw new Error('That add-on is not recognized.');
      }
    }

    if (lineItems.length === 0) {
      throw new Error('Everything selected is already active on this event.');
    }

    try {
      const stripe = new Stripe(secretKey);

      // A code can cover only part of the cart. A Stripe coupon applies to the
      // whole session, so instead of sending one, the covered lines are
      // re-priced directly and the rest are charged in full.
      const resolved = await resolveDiscount(event.arguments.discountCode, scopes);
      const discountMetadata: Record<string, string> = {};
      if (resolved) {
        const covered = new Set(resolved.coveredScopes);
        const adjusted = distributeDiscount(
          lineItems.map((item, i) => ({
            amountCents: item.price_data.unit_amount,
            covered: covered.has(scopes[i]),
          })),
          resolved,
        );
        lineItems.forEach((item, i) => {
          if (adjusted[i] !== item.price_data.unit_amount) {
            item.price_data.unit_amount = adjusted[i];
            // Stripe shows no discount line when the price itself is lowered,
            // so say so on the item the host is looking at.
            item.price_data.product_data.name += ' — discount applied';
          }
        });
        discountMetadata.discountCode = resolved.code;
        discountMetadata.discountAppliedTo = resolved.coveredScopes.join(',');
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        success_url: `${appBaseUrl}/event/${addonEventId}/admin?addon=done`,
        cancel_url: `${appBaseUrl}/event/${addonEventId}/admin?addon=cancelled`,
        // The webhook applies one side effect per key listed here.
        metadata: {
          kind: 'addons',
          eventId: addonEventId,
          addons: scopes.join(','),
          ...discountMetadata,
        },
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Stripe add-on checkout failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Optional: the pending event this payment activates once it completes.
  const eventId = event.arguments.eventId ?? '';

  // When this payment activates a real event, both the plan and the amount come
  // from that event's stored row — never from the request. The caller-supplied
  // `tier` is used only for the admin test checkout, which activates nothing.
  const storedEvent = eventId ? await eventRowFor(eventId) : null;
  const source = pricingSourceFor({
    eventId,
    argumentTier: event.arguments.tier ?? '',
    stored: storedEvent,
    // Buying something new is limited to what is on sale; paying for an event
    // that already exists only needs a price, so a retired plan can still be
    // activated by the host who created it.
    sellableTier: (candidate) => SELLABLE_TIERS.has(candidate),
    priceableTier: (candidate) => Boolean(TIER_PRICING[candidate]),
    caller: event.identity as { sub?: string; groups?: string[] | null } | undefined,
  });
  if (source.kind === 'refused') throw new Error(source.reason);

  const tier = source.tier;
  const pricing = TIER_PRICING[tier];

  const appUrl = process.env.APP_URL ?? 'https://www.sharepix.net';
  // When paying for a real event, land back on a page that activates it; the
  // admin test checkout (no eventId) keeps the generic success page.
  const successUrl = eventId
    ? `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&eventId=${encodeURIComponent(eventId)}`
    : `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = eventId
    ? `${appUrl}/my-events?checkout=cancelled`
    : `${appUrl}/global-admin?checkout=cancelled`;
  try {
    const stripe = new Stripe(secretKey);
    // Event plans are scoped per tier (event:starter / :standard / :premium), so
    // a code can be limited to one plan.
    const disc = await buildDiscount(stripe, event.arguments.discountCode, [`event:${tier}`], pricing.amount);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: pricing.amount,
            product_data: { name: pricing.name },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tier, eventId, ...disc.metadata },
      discounts: disc.discounts,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    return { url: session.url };
  } catch (error) {
    throw new Error(`Stripe checkout failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
