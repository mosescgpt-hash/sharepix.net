import {
  applyPercentOff,
  computeAccessExpiresAt,
  computeUploadWindowEndsAt,
  extensionPrice,
  getTier,
  CORPORATE_PLAN,
  LIVE_SLIDESHOW_ADDON_PRICE,
  PRICING_TIERS,
  UPLOAD_WINDOW_DAYS,
  videoLimitForTier,
  videosRemaining,
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
    expect(extensionPrice('starter')).toBe(10); // 19 / 2, rounded
    expect(extensionPrice('standard')).toBe(20); // 39 / 2, rounded
    expect(extensionPrice('premium')).toBe(40); // 79 / 2, rounded
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
    expect(getTier('starter')?.price).toBe(19);
    expect(getTier('standard')?.price).toBe(39);
    expect(getTier('premium')?.price).toBe(79);
    expect(CORPORATE_PLAN.price).toBe(149);
  });

  it('keeps add-on prices in step with the cent amounts the function charges', () => {
    // stripe-checkout hard-codes these in cents; if one side moves, this fails.
    expect(LIVE_SLIDESHOW_ADDON_PRICE * 100).toBe(2900);
  });

  it('prices every tier above the egress a full-resolution event can generate', () => {
    // Guest downloads are included now, so each plan has to carry its own
    // bandwidth. A ceiling-case event is roughly 6 GB of originals; at ~$0.09/GB
    // even 20 full-event downloads is about $11, which the cheapest plan must
    // still clear with room for Stripe's fee.
    for (const tier of PRICING_TIERS) {
      expect(tier.price).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('video allowances', () => {
  it('gives every tier a real number, never unlimited', () => {
    // A video is the one upload whose cost is not bounded by resizing, so
    // `null` (unlimited) on a paid tier would be an open-ended bill.
    for (const tier of PRICING_TIERS) {
      expect(typeof tier.videoLimit).toBe('number');
      expect(tier.videoLimit).toBeGreaterThan(0);
    }
    expect(typeof CORPORATE_PLAN.videoLimit).toBe('number');
  });

  it('never gives a cheaper plan more videos than a dearer one', () => {
    const byPrice = [...PRICING_TIERS].sort((a, b) => a.price - b.price);
    for (let i = 1; i < byPrice.length; i += 1) {
      expect(byPrice[i].videoLimit!).toBeGreaterThanOrEqual(byPrice[i - 1].videoLimit!);
    }
  });

  it('stamps corporate events explicitly instead of leaving them unlimited', () => {
    // Corporate has no PricingTier row, so a plain lookup returns undefined —
    // and `undefined ?? null` would silently mean "unlimited videos".
    expect(getTier('corporate')).toBeUndefined();
    expect(videoLimitForTier('corporate')).toBe(CORPORATE_PLAN.videoLimit);
    expect(videoLimitForTier('standard')).toBe(getTier('standard')!.videoLimit);
  });

  it('counts remaining videos, including purchased credits', () => {
    expect(videosRemaining({ videoLimit: 10, videoCount: 3 })).toBe(7);
    expect(videosRemaining({ videoLimit: 10, videoCount: 3, extraVideoCredits: 5 })).toBe(12);
    expect(videosRemaining({ videoLimit: 2, videoCount: 2 })).toBe(0);
  });

  it('never reports a negative remainder', () => {
    // A limit lowered after uploads (or a comped event) must read as 0, not -3.
    expect(videosRemaining({ videoLimit: 2, videoCount: 5 })).toBe(0);
  });

  it('treats an event with no limit as unlimited, so older events keep working', () => {
    expect(videosRemaining({ videoCount: 40 })).toBeNull();
    expect(videosRemaining({ videoLimit: null, videoCount: 40 })).toBeNull();
  });

  it('treats a missing count as zero used', () => {
    expect(videosRemaining({ videoLimit: 10 })).toBe(10);
  });
});
