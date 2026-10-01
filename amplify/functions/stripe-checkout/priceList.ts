/**
 * Every price SharePix charges, in cents — the Lambda's copy.
 *
 * A byte-for-byte copy of lib/priceList.ts below this comment. Amplify
 * functions cannot import from lib/, so it is copied rather than shared, and
 * `__tests__/price-list.test.ts` fails if the two drift. Edit lib/priceList.ts
 * and re-copy; never edit this one on its own.
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

/** Events a Corporate subscription runs at the same time, at no extra cost. */
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
