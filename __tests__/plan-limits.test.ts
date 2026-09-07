import {
  CURRENT_PHOTO_LIMITS,
  CURRENT_VIDEO_LIMITS,
  entitledPhotoLimit,
  entitledVideoLimit,
  limitsAreStale,
} from '../lib/planLimits';
import { ALL_TIERS, CORPORATE_PLAN, videosRemaining } from '../lib/pricing';
import { bodyOf, readSource as read } from './sourceGuards';

describe('the copies have not drifted', () => {
  it('keeps create-event-photo/planLimits.ts byte-identical with lib/', () => {
    expect(bodyOf(read('amplify/functions/create-event-photo/planLimits.ts'))).toBe(
      bodyOf(read('lib/planLimits.ts')),
    );
  });

  it('keeps the duplicated tables equal to the tiers in pricing', () => {
    // This is the guard that would have caught the original bug. When a plan's
    // limit moves in pricing.ts and not here, every event already on that plan
    // keeps the old number — which is exactly what happened when the $79 plan
    // went from 3,000 photos to unlimited.
    for (const tier of ALL_TIERS) {
      expect(CURRENT_PHOTO_LIMITS).toHaveProperty(tier.id);
      expect(CURRENT_PHOTO_LIMITS[tier.id]).toBe(tier.photoLimit);
      expect(CURRENT_VIDEO_LIMITS[tier.id]).toBe(tier.videoLimit);
    }
  });

  it('covers corporate, which has no tier row', () => {
    // videoLimitForTier handles it explicitly for the same reason: falling
    // through to undefined here would silently mean "unknown tier".
    expect(CURRENT_VIDEO_LIMITS.corporate).toBe(CORPORATE_PLAN.videoLimit);
    expect(CURRENT_PHOTO_LIMITS.corporate).toBeNull();
  });
});

describe('the event the user actually reported', () => {
  // A $79 event bought before the plan went unlimited. Its row says 3,000.
  const stampedEvent = { tier: 'plus', photoLimit: 3000, videoLimit: 30 };

  it('gives it the unlimited photos its plan now includes', () => {
    expect(entitledPhotoLimit(stampedEvent)).toBeNull();
  });

  it('leaves its video allowance exactly where it was', () => {
    // Photos went unlimited. Videos did not, and nothing here may quietly make
    // them so — video is the one upload whose cost is not bounded by resizing.
    expect(entitledVideoLimit(stampedEvent)).toBe(30);
  });

  it('is reported as stale so an operator can see why the row disagrees', () => {
    expect(limitsAreStale(stampedEvent)).toBe(true);
    expect(limitsAreStale({ tier: 'plus', photoLimit: null, videoLimit: 30 })).toBe(false);
  });
});

describe('a limit can only ever go up', () => {
  it('never returns less than what was stamped', () => {
    // The safety property. A host who was sold 1,000 photos keeps 1,000 even
    // if the plan they are on is worth less today than it was then.
    const cases: Array<[string, number]> = [
      ['event', 5000],
      ['starter', 900],
      ['standard', 4000],
      ['free', 250],
    ];
    for (const [tier, stored] of cases) {
      const result = entitledPhotoLimit({ tier, photoLimit: stored });
      expect(result === null || result >= stored).toBe(true);
    }
  });

  it('raises a row stamped below its current plan', () => {
    expect(entitledPhotoLimit({ tier: 'standard', photoLimit: 100 })).toBe(1000);
  });

  it('leaves a row already at its plan alone', () => {
    expect(entitledPhotoLimit({ tier: 'starter', photoLimit: 100 })).toBe(100);
    expect(entitledVideoLimit({ tier: 'free', videoLimit: 1 })).toBe(1);
  });
});

describe('what it refuses to guess', () => {
  it('changes nothing for a tier it does not recognise', () => {
    // A tier string we cannot resolve is missing information, not a licence to
    // invent an entitlement. Inventing one here turns a typo into unlimited
    // storage on an event nobody paid for.
    expect(entitledPhotoLimit({ tier: 'enterprise-2027', photoLimit: 500 })).toBe(500);
    expect(entitledPhotoLimit({ tier: '', photoLimit: 500 })).toBe(500);
    expect(entitledVideoLimit({ tier: 'nonsense', videoLimit: 4 })).toBe(4);
  });

  it('accepts a tier in any case, because the row is not normalised', () => {
    expect(entitledPhotoLimit({ tier: 'PLUS', photoLimit: 3000 })).toBeNull();
  });

  it('treats a missing or unreadable limit as unlimited, as it always has', () => {
    // Pre-existing behaviour rather than a new decision: events created before
    // limits existed carry no value and have always uploaded freely. Asserted
    // so that a change to it has to be deliberate.
    expect(entitledPhotoLimit({ tier: 'plus' })).toBeNull();
    expect(entitledPhotoLimit({ tier: 'starter', photoLimit: null })).toBeNull();
    expect(entitledPhotoLimit({ tier: 'starter', photoLimit: Number.NaN })).toBeNull();
    expect(entitledPhotoLimit({ tier: 'starter', photoLimit: -5 })).toBeNull();
  });

  it('handles a missing row rather than throwing at upload time', () => {
    expect(entitledPhotoLimit(null)).toBeNull();
    expect(entitledVideoLimit(undefined)).toBeNull();
    expect(limitsAreStale(null)).toBe(false);
  });
});

describe('what a guest is shown matches what the server will accept', () => {
  it('counts videos against the entitlement, not the stamped row', () => {
    // Showing a smaller allowance than the server would accept turns an upload
    // that would have worked into one the guest never attempts.
    expect(
      videosRemaining({ tier: 'plus', videoLimit: 30, videoCount: 10 }),
    ).toBe(20);
    // A row stamped lower than the plan is now: the guest sees the real room.
    expect(
      videosRemaining({ tier: 'standard', videoLimit: 2, videoCount: 0 }),
    ).toBe(10);
  });

  it('still returns null for an event with no limit at all', () => {
    expect(videosRemaining({ tier: 'plus' })).toBeNull();
  });

  it('still honours add-on credits on top', () => {
    expect(
      videosRemaining({ tier: 'plus', videoLimit: 30, extraVideoCredits: 5, videoCount: 30 }),
    ).toBe(5);
  });
});

describe('the upload handler enforces the entitlement', () => {
  const handler = read('amplify/functions/create-event-photo/handler.ts');

  it('resolves the limits through planLimits rather than reading the row', () => {
    // The row is what the bug was. Reading `ev.photoLimit` directly here is the
    // thing that capped a paid, unlimited event at 3,000.
    expect(handler).toContain('const photoLimit = entitledPhotoLimit(planRow)');
    expect(handler).toContain('const videoLimit = entitledVideoLimit(planRow)');
  });

  it('passes the tier, without which no entitlement can be resolved', () => {
    expect(handler).toContain('tier: ev.tier?.S');
  });
});
