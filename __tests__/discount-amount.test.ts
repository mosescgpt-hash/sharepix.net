import {
  distributeDiscount,
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

describe('distributeDiscount (mixed cart: code covers only some lines)', () => {
  const percent = (percentOff: number) =>
    ({ discountType: 'percent' as const, percentOff, amountOffCents: 0 });
  const amount = (amountOffCents: number) =>
    ({ discountType: 'amount' as const, percentOff: 0, amountOffCents });

  it('discounts only the covered line and leaves the rest at full price', () => {
    // $13 extension (not covered) + $29 slideshow (covered), 50% off.
    const out = distributeDiscount(
      [
        { amountCents: 1300, covered: false },
        { amountCents: 2900, covered: true },
      ],
      percent(50),
    );
    expect(out).toEqual([1300, 1450]);
  });

  it('spreads a fixed amount across covered lines only, once — not per line', () => {
    const out = distributeDiscount(
      [
        { amountCents: 1000, covered: true },
        { amountCents: 3000, covered: true },
        { amountCents: 1500, covered: false },
      ],
      amount(1000),
    );
    // $10 off the $40 covered subtotal, split 1:3; the uncovered line is untouched.
    expect(out[2]).toBe(1500);
    expect(out[0] + out[1]).toBe(4000 - 1000);
  });

  it('keeps the totals exact when a split would not divide evenly', () => {
    const lines = [
      { amountCents: 333, covered: true },
      { amountCents: 333, covered: true },
      { amountCents: 334, covered: true },
    ];
    const out = distributeDiscount(lines, amount(100));
    expect(out.reduce((a, b) => a + b, 0)).toBe(1000 - 100);
  });

  it('caps a fixed amount at the covered subtotal — never a negative line', () => {
    const out = distributeDiscount(
      [
        { amountCents: 2900, covered: true },
        { amountCents: 1300, covered: false },
      ],
      amount(999999),
    );
    expect(out).toEqual([0, 1300]);
  });

  it('makes an all-covered cart free when the remainder would be unchargeable', () => {
    const out = distributeDiscount([{ amountCents: 1000, covered: true }], amount(980));
    expect(out).toEqual([0]);
  });

  it('leaves an uncovered line intact even when the covered part goes to zero', () => {
    // The uncovered line keeps the total chargeable, so no rounding-up applies.
    const out = distributeDiscount(
      [
        { amountCents: 1000, covered: true },
        { amountCents: 1300, covered: false },
      ],
      percent(100),
    );
    expect(out).toEqual([0, 1300]);
  });

  it('returns the cart untouched when the code covers nothing in it', () => {
    const lines = [
      { amountCents: 1300, covered: false },
      { amountCents: 2900, covered: false },
    ];
    expect(distributeDiscount(lines, percent(50))).toEqual([1300, 2900]);
  });
});
