import {
  ALL_TIERS,
  CORPORATE_PLAN,
  PRICING_TIERS,
  extensionPrice,
  getTier,
  isSellableTier,
  liveSlideshowAvailable,
  videoLimitForTier,
  computeAccessExpiresAt,
  UPLOAD_WINDOW_DAYS,
} from '../lib/pricing';
import { guestBookAvailable } from '../lib/guestBook';

/**
 * The guarantee this file exists to defend:
 *
 * An event stamps its tier at creation so that a later pricing change can never
 * retroactively alter what someone already paid for. Retiring a plan must
 * change what can be BOUGHT and nothing else.
 *
 * Every failure below is silent in production if it regresses — no error, no
 * log, just the wrong limit or the wrong charge.
 */

const RETIRED = ['starter', 'standard', 'premium'];
const SELLABLE = ['event', 'plus'];

describe('what is on sale', () => {
  it('sells Event and Plus, and nothing retired', () => {
    expect(PRICING_TIERS.map((t) => t.id)).toEqual(SELLABLE);
  });

  it('prices them at $39 and $89', () => {
    expect(getTier('event')?.price).toBe(39);
    expect(getTier('plus')?.price).toBe(89);
  });

  it('keeps Corporate at $149/month', () => {
    expect(CORPORATE_PLAN.price).toBe(149);
  });

  it('reports retired plans as unsellable', () => {
    for (const id of RETIRED) expect(isSellableTier(id)).toBe(false);
    for (const id of SELLABLE) expect(isSellableTier(id)).toBe(true);
  });

  it('does not offer a free tier yet', () => {
    // Free removes the `paid` gate that currently means every live event has a
    // card behind it. It ships with rate limiting, not before.
    expect(PRICING_TIERS.some((t) => t.price === 0)).toBe(false);
  });
});

describe('retired plans still work for the events that bought them', () => {
  it.each(RETIRED)('%s is still resolvable', (id) => {
    expect(getTier(id)).toBeDefined();
    expect(getTier(id)?.retired).toBe(true);
  });

  // The specific trap: videoLimitForTier falls through to null for an unknown
  // tier, and null means UNLIMITED. Dropping a retired tier would hand every
  // legacy event unlimited video — the single most expensive upload type.
  it.each(RETIRED)('%s keeps a real video limit, never unlimited', (id) => {
    const limit = videoLimitForTier(id);
    expect(limit).not.toBeNull();
    expect(typeof limit).toBe('number');
  });

  it('keeps the exact video limits those plans were sold with', () => {
    expect(videoLimitForTier('starter')).toBe(2);
    expect(videoLimitForTier('standard')).toBe(10);
    expect(videoLimitForTier('premium')).toBe(30);
  });

  // extensionPrice falls back to $10 for an unknown tier, so a dropped tier
  // would undercharge a Premium host by half.
  it('charges the right extension price for a retired plan', () => {
    expect(extensionPrice('starter')).toBe(10); // half of $19, rounded
    expect(extensionPrice('standard')).toBe(20); // half of $39, rounded
    expect(extensionPrice('premium')).toBe(40); // half of $79, rounded
  });

  it('charges the right extension price for the plans on sale', () => {
    expect(extensionPrice('event')).toBe(20); // half of $39
    expect(extensionPrice('plus')).toBe(45); // half of $89, rounded up
  });

  it('keeps retention and access windows for retired plans', () => {
    expect(getTier('starter')?.retentionDays).toBe(21);
    expect(getTier('standard')?.retentionDays).toBe(90);
    expect(getTier('premium')?.retentionDays).toBe(365);
    // A dropped tier falls back to a 14-day access window, which would cut a
    // Premium host's gallery from a year to a fortnight.
    const premium = computeAccessExpiresAt('premium', new Date('2026-01-01T00:00:00Z'));
    expect(premium.startsWith('2027-01-01')).toBe(true);
  });

  it('leaves Premium unlimited on photos, because that is what it sold', () => {
    expect(getTier('premium')?.photoLimit).toBeNull();
  });
});

describe('one retention policy across everything on sale', () => {
  // Retention used to be a tier differentiator — 3 weeks, 3 months, 1 year —
  // which made "how long do I keep my photos" unanswerable without a table.
  // Every plan on sale now gets the same answer, and these assert it stays one
  // answer rather than quietly splitting again.
  it.each(SELLABLE)('gives %s a 12-month gallery', (id) => {
    expect(getTier(id)?.retentionDays).toBe(365);
    expect(getTier(id)?.guestLowResDays).toBe(365);
  });

  it('does not let guests lose the gallery before the host does', () => {
    // Guests seeing nothing while the host still has access is the state that
    // generates support mail, because the host is looking at a live gallery
    // while being told by a guest that it is gone.
    for (const id of SELLABLE) {
      const tier = getTier(id);
      expect(tier?.guestLowResDays).toBe(tier?.retentionDays);
    }
  });

  it('opens the upload window for 60 days on every plan', () => {
    expect(UPLOAD_WINDOW_DAYS).toBe(60);
    for (const id of SELLABLE) {
      expect(getTier(id)?.accessLabel).toBe('60-day upload window');
    }
  });

  it('runs access for the window plus the full twelve months', () => {
    for (const id of SELLABLE) {
      expect(getTier(id)?.accessDays).toBe(UPLOAD_WINDOW_DAYS + 365);
    }
  });

  it('leaves retired plans on the retention they were sold', () => {
    // Lengthening retention is a gift and could safely apply to everyone, but
    // these rows describe what a plan WAS. Editing them rewrites history.
    expect(getTier('starter')?.guestLowResDays).toBe(21);
    expect(getTier('standard')?.guestLowResDays).toBe(30);
    expect(getTier('premium')?.guestLowResDays).toBe(30);
  });

  it('says twelve months in the feature list of everything on sale', () => {
    for (const id of SELLABLE) {
      const features = getTier(id)?.features ?? [];
      expect(features.some((f) => /12 months/.test(f))).toBe(true);
      // The old per-plan phrasing, which is the thing that stopped being true.
      expect(features.some((f) => /host access (3 months|1 year)/i.test(f))).toBe(false);
    }
  });
});

describe('the unlimited claim is not carried forward', () => {
  it('caps Plus at a real number', () => {
    expect(getTier('plus')?.photoLimit).toBe(3000);
  });

  it('makes no unlimited photo claim on any per-event plan', () => {
    for (const tier of PRICING_TIERS) {
      expect(tier.photoLimit).not.toBeNull();
      const claims = tier.features.filter((f) => /unlimited/i.test(f));
      expect(claims).toEqual([]);
    }
  });

  // Corporate is deliberately excluded from the rule above and still advertises
  // unlimited photos. It was left unchanged in this reprice, and it is a
  // recurring subscription rather than a one-off, so the exposure can be ended
  // by cancelling rather than being unbounded against a single $89 payment.
  // Asserted rather than ignored so the claim cannot quietly move without
  // someone deciding to move it.
  it('knowingly leaves the unlimited claim on Corporate', () => {
    expect(CORPORATE_PLAN.features.some((f) => /unlimited photos/i.test(f))).toBe(true);
  });
});

describe('add-ons folded into Plus', () => {
  it('includes the guest book on Plus without an add-on purchase', () => {
    expect(guestBookAvailable({ tier: 'plus' })).toBe(true);
  });

  it('includes the live slideshow on Plus without an add-on purchase', () => {
    expect(liveSlideshowAvailable({ tier: 'plus' })).toBe(true);
  });

  it('still requires the add-on on Event', () => {
    expect(guestBookAvailable({ tier: 'event' })).toBe(false);
    expect(liveSlideshowAvailable({ tier: 'event' })).toBe(false);
  });

  it('honours a purchased add-on on any plan', () => {
    expect(guestBookAvailable({ tier: 'event', guestBookEnabled: true })).toBe(true);
    expect(liveSlideshowAvailable({ tier: 'event', liveSlideshowEnabled: true })).toBe(true);
  });

  // Legacy events that already paid for these keep them.
  it('keeps both included on Premium and Corporate', () => {
    for (const tier of ['premium', 'corporate']) {
      expect(guestBookAvailable({ tier })).toBe(true);
    }
    expect(liveSlideshowAvailable({ tier: 'corporate' })).toBe(true);
    // Premium predates the slideshow being bundled, so it was sold as an
    // add-on there and stays that way — the flag on the row still works.
    expect(liveSlideshowAvailable({ tier: 'premium', liveSlideshowEnabled: true })).toBe(true);
  });

  it('treats a missing event as having nothing', () => {
    expect(liveSlideshowAvailable(null)).toBe(false);
    expect(liveSlideshowAvailable(undefined)).toBe(false);
  });
});

describe('capabilities are flags, not id comparisons', () => {
  it('gives custom QR codes to everything except the old Starter', () => {
    expect(getTier('starter')?.customQrCode).toBe(false);
    for (const id of ['standard', 'premium', 'event', 'plus']) {
      expect(getTier(id)?.customQrCode).toBe(true);
    }
  });

  it('defines the flag on every tier, so a new one cannot inherit silently', () => {
    for (const tier of ALL_TIERS) {
      expect(typeof tier.customQrCode).toBe('boolean');
    }
  });
});
