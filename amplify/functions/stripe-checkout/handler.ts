import Stripe from 'stripe';
// @ts-ignore -- @aws-sdk/* is provided by the Lambda runtime, not installed as a dep.
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

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

// Validate a caller-supplied discount code against the DiscountCode table and
// return how much it takes off (1–100), or null when no code was supplied. The
// code, its expiry, remaining uses, and scope are all checked server-side — a
// crafted request can't apply a discount the admin didn't authorize. Throws a
// guest-facing message when a code was supplied but can't be used.
async function resolveDiscount(
  rawCode: string | null | undefined,
  scope: string,
): Promise<{ code: string; percentOff: number; duration: 'once' | 'forever' } | null> {
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
  // event:premium, corporate, extend, guest_download. ('all' is still honored
  // for codes created before plans were listed individually.) Legacy codes have
  // only appliesToTier, where 'all'/blank was universal and a specific tier only
  // ever applied to creating an event on that plan.
  const scopesRaw = (item.appliesToScopes?.S ?? '').toLowerCase().trim();
  let allowed: boolean;
  if (scopesRaw) {
    const entries = scopesRaw.split(',').map((entry) => entry.trim());
    allowed =
      scopesRaw === 'all' ||
      entries.includes(scope) ||
      // A pre-split 'event' scope covers every event plan.
      (scope.startsWith('event:') && entries.includes('event'));
  } else {
    const legacyTier = (item.appliesToTier?.S ?? '').toLowerCase();
    allowed =
      legacyTier === '' || legacyTier === 'all' ? true : scope === `event:${legacyTier}`;
  }
  if (!allowed) {
    throw new Error('That discount code does not apply to this purchase.');
  }

  // A missing percentOff (legacy codes) means a fully comped, free purchase.
  const percentOff = item.percentOff?.N != null ? Number(item.percentOff.N) : 100;
  if (!(percentOff >= 1 && percentOff <= 100)) {
    throw new Error('That discount code is misconfigured.');
  }
  // Recurring duration matters only for the Corporate subscription: 'forever'
  // discounts every month, 'once' (the default) only the first. Anything else is
  // treated as 'once'.
  const duration = item.recurringDuration?.S === 'forever' ? 'forever' : 'once';
  return { code, percentOff, duration };
}

// Reuse one Stripe coupon per percentage + duration, creating it on first use.
// The id encodes the duration so a "50% forever" and a "50% once" coupon never
// collide; the original once-coupons keep their plain SPX-PCT-{n} id.
async function couponFor(
  stripe: Stripe,
  percentOff: number,
  duration: 'once' | 'forever',
): Promise<string> {
  const id = duration === 'forever' ? `SPX-PCT-${percentOff}-FOREVER` : `SPX-PCT-${percentOff}`;
  try {
    await stripe.coupons.retrieve(id);
  } catch {
    try {
      await stripe.coupons.create({
        id,
        percent_off: percentOff,
        duration,
        name: `SharePix ${percentOff}% off${duration === 'forever' ? ' (recurring)' : ''}`,
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
  scope: string,
): Promise<{ discounts?: { coupon: string }[]; metadata: Record<string, string> }> {
  const resolved = await resolveDiscount(rawCode, scope);
  if (!resolved) return { metadata: {} };
  const coupon = await couponFor(stripe, resolved.percentOff, resolved.duration);
  return { discounts: [{ coupon }], metadata: { discountCode: resolved.code } };
}

// Prices mirror lib/pricing.ts (dollars → cents). Kept in sync by hand so the
// function has no cross-bundle imports.
const TIER_PRICING: Record<string, { name: string; amount: number }> = {
  starter: { name: 'SharePix Starter event', amount: 1000 },
  standard: { name: 'SharePix Standard event', amount: 2500 },
  premium: { name: 'SharePix Premium event', amount: 5000 },
};

// Mirrors LIVE_SLIDESHOW_ADDON_PRICE in lib/pricing.ts (dollars → cents).
const LIVE_SLIDESHOW_ADDON_CENTS = 2900;

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
      const disc = await buildDiscount(stripe, event.arguments.discountCode, 'corporate');
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
      const disc = await buildDiscount(stripe, event.arguments.discountCode, 'extend');
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

  // Guest-download add-on: a one-time $15 charge that enables guest downloads on
  // a single event. The webhook flips the event's guestDownloadEnabled flag.
  if ((event.arguments.kind ?? '') === 'guest_download') {
    const addOnEventId = event.arguments.eventId ?? '';
    if (!addOnEventId) throw new Error('Missing event for the download add-on.');
    // Only Premium and Corporate events may buy guest downloads.
    const tier = await eventTier(addOnEventId);
    if (tier !== 'premium' && tier !== 'corporate') {
      throw new Error('Guest downloads are available on Premium and Corporate events.');
    }
    try {
      const stripe = new Stripe(secretKey);
      const disc = await buildDiscount(stripe, event.arguments.discountCode, 'guest_download');
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: 1500,
              product_data: { name: 'SharePix guest-download add-on (one event)' },
            },
          },
        ],
        success_url: `${appBaseUrl}/event/${addOnEventId}/admin?addon=guestdownload`,
        cancel_url: `${appBaseUrl}/event/${addOnEventId}/admin?addon=cancelled`,
        metadata: { kind: 'guest_download', eventId: addOnEventId, ...disc.metadata },
        discounts: disc.discounts,
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Stripe add-on checkout failed: ${error instanceof Error ? error.message : String(error)}`,
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
      const disc = await buildDiscount(stripe, event.arguments.discountCode, 'live_slideshow');
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

  const tier = (event.arguments.tier ?? '').toLowerCase();
  const pricing = TIER_PRICING[tier];
  if (!pricing) {
    throw new Error('Unknown plan.');
  }

  // Optional: the pending event this payment activates once it completes.
  const eventId = event.arguments.eventId ?? '';

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
    const disc = await buildDiscount(stripe, event.arguments.discountCode, `event:${tier}`);
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
