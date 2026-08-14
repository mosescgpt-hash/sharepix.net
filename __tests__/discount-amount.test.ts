import {
  effectiveAmountOffCents,
  STRIPE_MIN_CHARGE_CENTS,
} from '../amplify/functions/stripe-checkout/discount-math';
import { applyDiscount } from '../lib/pricing';

describe('effectiveAmountOffCents (server: what Stripe is asked to take off)', () => {
  it('takes off exactly the code amount when the price comfortably covers it', () => {
    expect(effectiveAmountOffCents(1000, 5000)).toBe(1000); // $10 off a $50 event
    expect(effectiveAmountOffCents(500, 2500)).toBe(500);
  });

  it('caps at the price so a total can never go negative', () => {
    expect(effectiveAmountOffCents(5000, 1000)).toBe(1000); // $50 off a $10 event
    expect(effectiveAmountOffCents(999999, 2900)).toBe(2900);
  });

  it('covers the whole price when the remainder would be too small to charge', () => {
    // $9.80 off a $10 event leaves 20c, which Stripe cannot charge.
    expect(effectiveAmountOffCents(980, 1000)).toBe(1000);
    // One cent under the minimum is still unchargeable.
    expect(effectiveAmountOffCents(1000 - (STRIPE_MIN_CHARGE_CENTS - 1), 1000)).toBe(1000);
  });

  it('leaves a remainder alone once it reaches the minimum charge', () => {
    expect(effectiveAmountOffCents(1000 - STRIPE_MIN_CHARGE_CENTS, 1000)).toBe(950);
  });

  it('ignores nonsense input rather than producing a bad charge', () => {
    expect(effectiveAmountOffCents(0, 1000)).toBe(0);
    expect(effectiveAmountOffCents(-500, 1000)).toBe(0);
    expect(effectiveAmountOffCents(500, 0)).toBe(0);
    expect(effectiveAmountOffCents(Number.NaN, 1000)).toBe(0);
  });
});

describe('applyDiscount (client: the price the host is shown)', () => {
  it('subtracts a fixed amount', () => {
    expect(applyDiscount(50, { discountType: 'amount', amountOffCents: 1000 })).toBe(40);
    expect(applyDiscount(25, { discountType: 'amount', amountOffCents: 500 })).toBe(20);
  });

  it('never shows a negative price', () => {
    expect(applyDiscount(10, { discountType: 'amount', amountOffCents: 5000 })).toBe(0);
  });

  it('shows free when the remainder would be unchargeable — matching the server', () => {
    expect(applyDiscount(10, { discountType: 'amount', amountOffCents: 980 })).toBe(0);
  });

  it('still handles percentage codes', () => {
    expect(applyDiscount(50, { discountType: 'percent', percentOff: 50 })).toBe(25);
    expect(applyDiscount(50, { discountType: 'percent', percentOff: 100 })).toBe(0);
  });

  it('treats a code with no type as a percentage, so legacy codes are unchanged', () => {
    expect(applyDiscount(25, { percentOff: 20 })).toBe(20);
  });

  it('agrees with the server on whether a purchase ends up free', () => {
    // Same inputs through both paths: display says $0 exactly when the server
    // discounts the full price.
    const cases = [
      { price: 10, off: 980 },
      { price: 10, off: 5000 },
      { price: 50, off: 1000 },
      { price: 29, off: 2900 },
    ];
    for (const { price, off } of cases) {
      const shown = applyDiscount(price, { discountType: 'amount', amountOffCents: off });
      const charged =
        (price * 100 - effectiveAmountOffCents(off, Math.round(price * 100))) / 100;
      expect(shown).toBeCloseTo(charged, 2);
    }
  });
});
