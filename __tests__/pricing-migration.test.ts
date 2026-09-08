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
  canPurchaseFor,
  isTrialTier,
  UPLOAD_WINDOW_DAYS,
} from '../lib/pricing';
import { guestBookAvailable } from '../lib/guestBook';
import {
  BREAK_EVEN_STORAGE_GB,
  FAIR_USE_DEFAULTS,
  FAIR_USE_NOTICE,
  assessUsage,
} from '../lib/fairUse';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

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

const RETIRED = ['event', 'starter', 'standard', 'premium'];
const SELLABLE = ['free', 'plus'];
/** The plans a customer can actually be charged for. Excludes the free trial. */
const PAID = ['plus'];

describe('what is on sale', () => {
  it('sells a free trial and one paid plan, and nothing retired', () => {
    expect(PRICING_TIERS.map((t) => t.id)).toEqual(SELLABLE);
  });

  it('prices the one paid plan at $79, and the trial at nothing', () => {
    expect(getTier('plus')?.price).toBe(79);
    expect(getTier('free')?.price).toBe(0);
  });

  it('shows the paid plan as Full Event', () => {
    // The id stayed `plus`; the name did not. "Event" named the thing the plan
    // applies to rather than saying anything about it, and said nothing at all
    // beside "Free event" — where the whole question is what the money buys.
    expect(getTier('plus')?.name).toBe('Full Event');
    expect(getTier('event')?.name).toBe('Event (original)');
  });

  it('gives no two tiers the same display name', () => {
    // A host reading their dashboard, and an admin reading the event list,
    // both have to be able to tell which plan an event is on.
    const names = ALL_TIERS.map((tier) => tier.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names the plan the same way on the receipt as on the pricing page', () => {
    // TIER_PRICING in stripe-checkout is a hand-copy, and it is what the
    // customer reads at the moment of payment and on their card statement.
    // It named BOTH this plan and the retired $39 tier "SharePix Event", so
    // two purchases at two prices were indistinguishable afterwards.
    const checkout = read('amplify/functions/stripe-checkout/handler.ts');
    const block = checkout.slice(
      checkout.indexOf('const TIER_PRICING'),
      checkout.indexOf('};', checkout.indexOf('const TIER_PRICING')),
    );
    expect(block).toContain(`plus: { name: 'SharePix ${getTier('plus')?.name}'`);

    const stripeNames = [...block.matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
    expect(new Set(stripeNames).size).toBe(stripeNames.length);
  });

  it('keeps Corporate at $149/month', () => {
    expect(CORPORATE_PLAN.price).toBe(149);
  });

  it('reports retired plans as unsellable', () => {
    for (const id of RETIRED) expect(isSellableTier(id)).toBe(false);
    for (const id of SELLABLE) expect(isSellableTier(id)).toBe(true);
  });

  it('offers exactly one free tier, and marks it as a trial', () => {
    // `price === 0` is not what identifies a trial — a fully comped paid event
    // also owes nothing — so the flag is what everything else reads.
    const free = PRICING_TIERS.filter((t) => t.price === 0);
    expect(free.map((t) => t.id)).toEqual(['free']);
    expect(free[0].trial).toBe(true);
    expect(PRICING_TIERS.filter((t) => t.trial).map((t) => t.id)).toEqual(['free']);
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

  it('charges the right extension price for the plan on sale', () => {
    expect(extensionPrice('plus')).toBe(40); // half of $79, rounded up
    expect(extensionPrice('event')).toBe(20); // half of the retired $39
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

describe('one retention policy across everything sold', () => {
  // Retention used to be a tier differentiator — 3 weeks, 3 months, 1 year —
  // which made "how long do I keep my photos" unanswerable without a table.
  // Every PAID plan now gets the same answer, and these assert it stays one
  // answer rather than quietly splitting again. The free trial is the single
  // deliberate exception, pinned separately below.
  it.each(PAID)('gives %s a 12-month gallery', (id) => {
    expect(getTier(id)?.retentionDays).toBe(365);
    expect(getTier(id)?.guestLowResDays).toBe(365);
  });

  it('gives the free trial 30 days, which is most of the reason to upgrade', () => {
    expect(getTier('free')?.retentionDays).toBe(30);
    expect(getTier('free')?.guestLowResDays).toBe(30);
    expect(getTier('free')?.accessDays).toBe(UPLOAD_WINDOW_DAYS + 30);
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

  it('runs paid access for the window plus the full twelve months', () => {
    for (const id of PAID) {
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

  it('says twelve months in the feature list of every paid plan', () => {
    for (const id of PAID) {
      const features = getTier(id)?.features ?? [];
      expect(features.some((f) => /12 months/.test(f))).toBe(true);
      // The old per-plan phrasing, which is the thing that stopped being true.
      expect(features.some((f) => /host access (3 months|1 year)/i.test(f))).toBe(false);
    }
  });
});

describe('the unlimited claim, and what makes it honest', () => {
  // This block used to assert the OPPOSITE: that no per-event plan claimed
  // unlimited photos, because unlimited on a one-time payment was an unbounded
  // storage bill. That reasoning was right, and it has been answered rather
  // than abandoned — storage is now measured per event, media is deleted at the
  // end of the archive window instead of kept forever, and fair-use thresholds
  // make an abnormal event visible. The tests below pin the answers, not the
  // claim: unlimited is only defensible while all three hold.

  it('sells unlimited photos on the paid plan', () => {
    expect(getTier('plus')?.photoLimit).toBeNull();
    expect(getTier('plus')?.features.some((f) => /unlimited photos/i.test(f))).toBe(true);
  });

  it('still caps video, which is not bounded by resizing', () => {
    // A still is resized before it is ever served; a clip streams at full size
    // on every play. Video is the one upload whose cost a photo cap never
    // bounded, and no customer-facing video allowance should be set before real
    // usage and cost data exist.
    expect(getTier('plus')?.videoLimit).toBe(30);
    expect(getTier('plus')?.features.some((f) => /unlimited video/i.test(f))).toBe(false);
  });

  it('keeps the free trial capped, or it is not a trial', () => {
    expect(getTier('free')?.photoLimit).toBe(50);
    expect(getTier('free')?.features.some((f) => /unlimited photos/i.test(f))).toBe(false);
  });

  it('has something that actually deletes the storage unlimited implies', () => {
    // Without this, "unlimited for 12 months" means unlimited access and
    // forever of storage, and the promise is funded by nothing.
    expect(existsSync(join(root, 'amplify/functions/reclaim-storage/handler.ts'))).toBe(true);
    expect(read('lib/storageReclaim.ts')).toContain('export function reclaimVerdict');
  });

  it('has thresholds that flag abuse without capping a real event', () => {
    // Above any real event, and below the point the event stops paying for
    // itself. This used to assert only the first half against a hardcoded
    // 50,000, which is how the threshold ended up at 2.6x break-even.
    // __tests__/fair-use.test.ts owns the full set of invariants.
    expect(FAIR_USE_DEFAULTS.photoAbuseThreshold).toBeGreaterThan(10_000);
    expect(FAIR_USE_DEFAULTS.storageAbuseBytes / 1024 ** 3).toBeLessThan(
      BREAK_EVEN_STORAGE_GB,
    );
    // A REVIEW is not a block. The moment crossing a threshold starts refusing
    // a paying customer's guests, "unlimited" has quietly become a number
    // again — which is the exact thing this reprice was meant to stop.
    expect(
      assessUsage({ photoCount: FAIR_USE_DEFAULTS.photoReviewThreshold + 1 }).blocked,
    ).toBe(false);
  });

  it('tells the customer what fair use means, in the plan copy', () => {
    // An asterisk with nothing behind it is worse than no asterisk.
    expect(FAIR_USE_NOTICE).toMatch(/normal event use/i);
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

describe('nothing is sold against an event nobody paid for', () => {
  it('identifies the trial by its flag, not by costing nothing', () => {
    expect(isTrialTier('free')).toBe(true);
    for (const id of [...PAID, ...RETIRED, 'corporate', 'nonsense']) {
      expect(isTrialTier(id)).toBe(false);
    }
  });

  it('refuses every purchase against a free event', () => {
    expect(canPurchaseFor('free')).toBe(false);
  });

  it('still lets every paid plan buy, retired ones included', () => {
    // Retiring a plan must never strand the host on it. A Starter event can
    // still extend its window and still buy the guest book.
    for (const id of [...PAID, ...RETIRED, 'corporate']) {
      expect(canPurchaseFor(id)).toBe(true);
    }
  });

  it('does not invent a one-dollar extension for a free event', () => {
    // Half of $0 clamped to a $1 minimum is what the arithmetic would produce,
    // and $1 is not a price anyone decided on. Zero here means "not for sale",
    // which is what canPurchaseFor is the real check for.
    expect(extensionPrice('free')).toBe(0);
    expect(extensionPrice('plus')).toBeGreaterThan(0);
  });

  it('gives the free trial no customizable QR code', () => {
    expect(getTier('free')?.customQrCode).toBe(false);
    expect(getTier('plus')?.customQrCode).toBe(true);
  });

  it('includes the guest book and slideshow in the paid plan, not as add-ons', () => {
    // The whole point of one plan: the two features that sell the product are
    // in it rather than behind a second decision.
    expect(guestBookAvailable({ tier: 'plus' })).toBe(true);
    expect(liveSlideshowAvailable({ tier: 'plus' })).toBe(true);
    // And neither is quietly granted to a trial.
    expect(guestBookAvailable({ tier: 'free' })).toBe(false);
    expect(liveSlideshowAvailable({ tier: 'free' })).toBe(false);
  });
});
