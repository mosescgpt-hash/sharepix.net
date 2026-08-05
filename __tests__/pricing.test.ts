import {
  applyPercentOff,
  computeAccessExpiresAt,
  computeUploadWindowEndsAt,
  extensionPrice,
  getTier,
  CORPORATE_PLAN,
  PRICING_TIERS,
  UPLOAD_WINDOW_DAYS,
} from '../lib/pricing';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('applyPercentOff (discount math)', () => {
  it('takes a clean percentage off each plan price', () => {
    expect(applyPercentOff(10, 20)).toBe(8); // Starter, 20% off
    expect(applyPercentOff(25, 20)).toBe(20); // Standard, 20% off
    expect(applyPercentOff(50, 50)).toBe(25); // Premium, 50% off
    expect(applyPercentOff(10, 50)).toBe(5);
  });

  it('makes a 100%-off code fully free', () => {
    for (const tier of PRICING_TIERS) {
      expect(applyPercentOff(tier.price, 100)).toBe(0);
    }
    expect(applyPercentOff(149, 100)).toBe(0); // corporate
  });

  it('leaves the price unchanged at 0% off', () => {
    expect(applyPercentOff(25, 0)).toBe(25);
  });

  it('rounds to whole cents rather than emitting fractions of a cent', () => {
    // 25 * (1 - 0.333...) would be 16.675; check a value that needs rounding.
    expect(applyPercentOff(9.99, 50)).toBe(5); // 4.995 -> 5.00
    expect(applyPercentOff(10, 33)).toBe(6.7); // 6.70
  });

  it('clamps out-of-range percentages so a total is never negative or inflated', () => {
    expect(applyPercentOff(50, 150)).toBe(0); // over 100 -> free, not negative
    expect(applyPercentOff(50, -20)).toBe(50); // below 0 -> no discount
  });
});

describe('extensionPrice', () => {
  it('is half the plan price with a $1 floor', () => {
    expect(extensionPrice('starter')).toBe(5); // 10 / 2
    expect(extensionPrice('standard')).toBe(13); // 25 / 2, rounded
    expect(extensionPrice('premium')).toBe(25); // 50 / 2
  });

  it('falls back to a sane default for an unknown tier', () => {
    expect(extensionPrice('mystery')).toBe(10); // 20 / 2
  });
});

describe('access + upload windows', () => {
  const from = new Date('2026-01-01T00:00:00Z');

  it('sets the upload window 30 days out', () => {
    const end = new Date(computeUploadWindowEndsAt(from));
    expect((end.getTime() - from.getTime()) / DAY_MS).toBe(UPLOAD_WINDOW_DAYS);
  });

  it('gives each plan its own access length', () => {
    for (const tier of PRICING_TIERS) {
      const expiry = new Date(computeAccessExpiresAt(tier.id, from));
      expect((expiry.getTime() - from.getTime()) / DAY_MS).toBe(tier.accessDays);
    }
  });

  it('gives corporate events the upload window plus full retention', () => {
    const expiry = new Date(computeAccessExpiresAt('corporate', from));
    const days = (expiry.getTime() - from.getTime()) / DAY_MS;
    expect(days).toBe(UPLOAD_WINDOW_DAYS + CORPORATE_PLAN.retentionDays);
  });

  it('falls back to a short window for an unknown tier', () => {
    const expiry = new Date(computeAccessExpiresAt('mystery', from));
    expect((expiry.getTime() - from.getTime()) / DAY_MS).toBe(14);
  });
});

describe('pricing tiers stay in sync with the checkout function', () => {
  // The stripe-checkout Lambda hard-codes these dollar amounts (as cents) since
  // it can't import this module. If a plan price changes here, update it there
  // too — this guard makes a drift visible in tests.
  it('has the expected published prices', () => {
    expect(getTier('starter')?.price).toBe(10);
    expect(getTier('standard')?.price).toBe(25);
    expect(getTier('premium')?.price).toBe(50);
    expect(CORPORATE_PLAN.price).toBe(149);
  });
});
