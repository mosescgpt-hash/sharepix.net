/**
 * The launch offer banner, behind one switch.
 *
 * Set `SHOW_LAUNCH_PROMO` to `false` and the banner disappears from the
 * homepage, /pricing and every use-case landing page at once — they all render
 * `components/OfferBanner.tsx`, which is the only reader of this file.
 *
 * ## Keep the words true
 *
 * "Only 20 available" is a promise about the SHAREFREE discount code, which is a
 * row in the DiscountCode table (created in the admin screen), not something
 * this repository defines. Before leaving the banner on, check that the code
 * exists with a use limit of 20 and has not run out. When the last one is
 * redeemed, flip the flag — a banner for an offer that has ended is the same
 * kind of stale claim `lib/differentiators.ts` exists to prevent.
 */
export const SHOW_LAUNCH_PROMO = true;

/** Word for word as the owner wrote it. Change it here and nowhere else. */
export const LAUNCH_PROMO_TEXT =
  'Launch offer: your first Full Event is free with code SHAREFREE. Only 20 available.';
