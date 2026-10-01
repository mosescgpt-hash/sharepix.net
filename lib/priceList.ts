/**
 * Every price SharePix charges, in cents, in one place.
 *
 * ## Why this file exists
 *
 * Prices used to be typed three times: dollars in lib/pricing.ts, cents in
 * TIER_PRICING in stripe-checkout, and cents again in TIER_PLANS in
 * create-event. Only a comment linked them. A reprice that touched one and
 * not the others would advertise one price and charge another, and nothing
 * would error.
 *
 * Amplify functions cannot import from lib/, so the copies still exist, but
 * they are now byte-identical copies of THIS file rather than three separate
 * lists. `__tests__/price-list.test.ts` fails if a copy drifts, and fails if
 * a handler types a price literal instead of reading one from here.
 *
 * Edit this file, then copy it over:
 *
 *   amplify/functions/stripe-checkout/priceList.ts
 *   amplify/functions/create-event/priceList.ts
 *
 * Only the doc comment above the first line of code may differ.
 */

/**
 * One-time price of a single event, by tier id. Retired tiers stay: an event
 * that carries one can still be paid for and still extends at half its price.
 * The trial tiers are $0 here and are deliberately NOT priceable at Stripe —
 * see TIER_PRICING in stripe-checkout.
 */
export const PLAN_PRICE_CENTS = {
  // On sale.
  trial: 0,
  plus: 7900,
  // Retired — priced, not sold.
  free: 0,
  event: 3900,
  starter: 1900,
  standard: 3900,
  premium: 7900,
} as const;

/** The Corporate subscription, per month. */
export const CORPORATE_MONTHLY_CENTS = 14900;

/**
 * New events a Corporate subscription includes each calendar month (UTC).
 *
 * Counted per month rather than at a time: a cap on events running at once
 * holds each one for its whole 60-day upload window, which works out at about
 * five new events a month — half of what the plan is meant to give. Unused
 * events do not roll over, and there is no limit on how many run at once.
 */
export const CORPORATE_INCLUDED_EVENTS = 10;

/**
 * One more event beyond the included ten, for a Corporate subscriber.
 *
 * $49 against the $79 single-event price: the subscriber has already paid for
 * the account, the branding and the dashboard, so an extra event is only the
 * storage and the support behind it. Sold one event at a time, through the
 * same checkout a single event uses, so there is nothing new to reconcile.
 */
export const CORPORATE_EXTRA_EVENT_CENTS = 4900;

/** One-time live slideshow add-on, for the retired plans that lack it. */
export const LIVE_SLIDESHOW_ADDON_CENTS = 2900;

/** One-time guest book add-on, for the retired plans that lack it. */
export const GUEST_BOOK_ADDON_CENTS = 1900;
