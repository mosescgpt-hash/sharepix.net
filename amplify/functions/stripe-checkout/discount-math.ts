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

export interface CartLine {
  amountCents: number;
  /** Whether the discount code's scope covers this line. */
  covered: boolean;
}

export interface CartDiscount {
  discountType: 'percent' | 'amount';
  percentOff: number;
  amountOffCents: number;
}

/**
 * Price each line of a mixed cart after a discount that may only cover some of
 * it. Returns the amount to charge per line, in the same order.
 *
 * A Stripe coupon applies to a whole Checkout Session and there is no per-line
 * discount, so a partially-scoped code can't be expressed as a coupon at all.
 * Instead the covered lines are re-priced directly and no coupon is sent.
 *
 * A fixed amount is taken off the covered subtotal **once**, not per line, and
 * is then spread across the covered lines in proportion to their price. Any
 * rounding remainder lands on the last covered line so the total is exact.
 */
export function distributeDiscount(lines: CartLine[], discount: CartDiscount): number[] {
  const amounts = lines.map((line) => Math.max(0, Math.round(line.amountCents)));
  const coveredTotal = lines.reduce(
    (sum, line, i) => (line.covered ? sum + amounts[i] : sum),
    0,
  );
  if (coveredTotal <= 0) return amounts;

  let reduction =
    discount.discountType === 'amount'
      ? Math.min(Math.max(0, Math.round(discount.amountOffCents)), coveredTotal)
      : Math.round((coveredTotal * Math.min(100, Math.max(0, discount.percentOff))) / 100);
  reduction = Math.min(reduction, coveredTotal);

  // Stripe can't charge between 1c and its minimum. That's only reachable when
  // every line is covered — any uncovered line keeps the total well above it —
  // so in that case round the discount up to make the whole cart free.
  const uncoveredTotal = amounts.reduce(
    (sum, amount, i) => (lines[i].covered ? sum : sum + amount),
    0,
  );
  const projected = coveredTotal - reduction + uncoveredTotal;
  if (uncoveredTotal === 0 && projected > 0 && projected < STRIPE_MIN_CHARGE_CENTS) {
    reduction = coveredTotal;
  }

  const coveredIndexes = lines
    .map((line, i) => (line.covered ? i : -1))
    .filter((i) => i !== -1);
  const lastCovered = coveredIndexes[coveredIndexes.length - 1];

  const result = [...amounts];
  let applied = 0;
  for (const i of coveredIndexes) {
    if (i === lastCovered) {
      // Absorb the rounding remainder here so the totals reconcile exactly.
      result[i] = Math.max(0, amounts[i] - (reduction - applied));
    } else {
      const share = Math.floor((reduction * amounts[i]) / coveredTotal);
      applied += share;
      result[i] = Math.max(0, amounts[i] - share);
    }
  }
  return result;
}
