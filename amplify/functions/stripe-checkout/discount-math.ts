/**
 * Money rules for fixed-amount discount codes, kept pure so they can be unit
 * tested without calling Stripe.
 */

/**
 * Stripe won't process a card charge below this. A discount that leaves a few
 * cents owing would fail at checkout rather than merely look odd.
 */
export const STRIPE_MIN_CHARGE_CENTS = 50;

/**
 * How much a fixed-amount code actually takes off a given price.
 *
 * Two cases the raw value can't cover:
 *  - the code is worth more than the item, so it's capped at the price rather
 *    than producing a negative total;
 *  - the code leaves a remainder too small for Stripe to charge (e.g. $9.80 off
 *    a $10 event leaves 20c). Rather than failing checkout with a confusing
 *    error, the discount is rounded up to cover the whole price — the customer
 *    was owed all but a few cents anyway.
 */
export function effectiveAmountOffCents(
  amountOffCents: number,
  baseAmountCents: number,
): number {
  if (!Number.isFinite(amountOffCents) || amountOffCents <= 0) return 0;
  if (!Number.isFinite(baseAmountCents) || baseAmountCents <= 0) return 0;

  const capped = Math.min(Math.round(amountOffCents), baseAmountCents);
  const remainder = baseAmountCents - capped;
  if (remainder > 0 && remainder < STRIPE_MIN_CHARGE_CENTS) return baseAmountCents;
  return capped;
}
