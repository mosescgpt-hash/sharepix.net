import {
  ASSET_DECISIONS,
  CONSENT_SUMMARY,
  MARKETING_TIERS,
  RELEASE_VERSION,
  REVIEW_CHECKS,
  RIGHTS_QUESTIONS,
  SUBMISSION_STATUSES,
  canTransition,
  compensationState,
  meetsTier,
  refundValueUsd,
  tierByKey,
  usableAssets,
  type SubmissionStatus,
  type SubmittedAsset,
} from '../lib/marketingRelease';

const asset = (photoId: string, decision: SubmittedAsset['decision']): SubmittedAsset => ({
  photoId,
  decision,
});

const accepted = (count: number) =>
  Array.from({ length: count }, (_, i) => asset(`p${i}`, 'ACCEPTED'));

describe('the release', () => {
  it('is versioned, so an old grant keeps its own wording', () => {
    // A licence given in 2026 means what the 2026 text said, not what a later
    // version says.
    expect(RELEASE_VERSION).toMatch(/^marketing-release-v\d+\.\d+$/);
  });

  it('says plainly what it does and does not cover', () => {
    expect(CONSENT_SUMMARY).toMatch(/only the photos you pick/i);
    expect(CONSENT_SUMMARY).toMatch(/gallery stays private/i);
    expect(CONSENT_SUMMARY).toMatch(/withdraw/i);
  });

  it('asks the customer to confirm what is not theirs to grant', () => {
    // A host can grant what is theirs and no more. A contract cannot make a
    // stranger in the background of a photo into a consenting party.
    const joined = RIGHTS_QUESTIONS.join(' ').toLowerCase();
    expect(joined).toMatch(/photographer/);
    expect(joined).toMatch(/recognised|recognized/);
  });
});

describe('the tiers', () => {
  it('offers only the two the programme recommends starting with', () => {
    expect(MARKETING_TIERS.map((t) => t.key)).toEqual(['featured_event', 'spotlight_story']);
  });

  it('gives each a sane asset range and a capped refund', () => {
    for (const tier of MARKETING_TIERS) {
      expect(tier.minAssets).toBeGreaterThan(0);
      expect(tier.maxAssets).toBeGreaterThanOrEqual(tier.minAssets);
      expect(tier.refundPercent).toBeGreaterThan(0);
      expect(tier.refundCapUsd).toBeGreaterThan(0);
    }
  });

  it('finds a tier by key and nothing by a made-up one', () => {
    expect(tierByKey('featured_event')?.label).toBe('Featured Event');
    expect(tierByKey('free_money')).toBeUndefined();
  });
});

describe('what a tier is worth', () => {
  const featured = tierByKey('featured_event')!;
  const spotlight = tierByKey('spotlight_story')!;

  it('is a percentage of what was actually paid', () => {
    expect(refundValueUsd(featured, 79)).toBe(19);
    expect(refundValueUsd(spotlight, 79)).toBe(39);
  });

  it('respects the cap', () => {
    expect(refundValueUsd(spotlight, 500)).toBe(50);
    expect(refundValueUsd(featured, 500)).toBe(25);
  });

  it('is nothing on a comped event', () => {
    // Offering a refund on a free event would be inventing money rather than
    // returning it.
    expect(refundValueUsd(featured, 0)).toBe(0);
    expect(refundValueUsd(featured, -79)).toBe(0);
  });
});

describe('the submission states', () => {
  it('moves forward through review', () => {
    expect(canTransition('INVITED', 'SUBMITTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'IN_REVIEW')).toBe(true);
    expect(canTransition('IN_REVIEW', 'ACCEPTED')).toBe(true);
    expect(canTransition('IN_REVIEW', 'DECLINED')).toBe(true);
  });

  it('cannot skip review to acceptance', () => {
    expect(canTransition('SUBMITTED', 'ACCEPTED')).toBe(false);
    expect(canTransition('INVITED', 'ACCEPTED')).toBe(false);
  });

  it('can be paused from anywhere a licence could be live', () => {
    // The programme requires that use stops promptly when a dispute arrives.
    expect(canTransition('ACCEPTED', 'PAUSED')).toBe(true);
    expect(canTransition('IN_REVIEW', 'PAUSED')).toBe(true);
    expect(canTransition('SUBMITTED', 'PAUSED')).toBe(true);
  });

  it('lets a customer withdraw from any live state', () => {
    for (const from of SUBMISSION_STATUSES) {
      if (from === 'WITHDRAWN') continue;
      expect(canTransition(from, 'WITHDRAWN')).toBe(true);
    }
  });

  it('never moves a withdrawal on', () => {
    // A customer who took their permission back does not get clicked past by an
    // admin working through a queue.
    for (const to of SUBMISSION_STATUSES) {
      expect(canTransition('WITHDRAWN', to)).toBe(false);
    }
  });

  it('never treats a state as a move to itself', () => {
    for (const state of SUBMISSION_STATUSES) {
      expect(canTransition(state, state)).toBe(false);
    }
  });

  it('does not reopen a decided submission except to pause or withdraw', () => {
    expect(canTransition('DECLINED', 'ACCEPTED')).toBe(false);
    expect(canTransition('ACCEPTED', 'IN_REVIEW')).toBe(false);
  });
});

describe('which assets may be used', () => {
  it('is only the accepted ones', () => {
    // A photo somebody showed us is not a photo we may publish.
    const assets = [asset('a', 'ACCEPTED'), asset('b', 'PENDING'), asset('c', 'REJECTED')];
    expect(usableAssets(assets).map((a) => a.photoId)).toEqual(['a']);
  });

  it('is nothing before review', () => {
    expect(usableAssets([asset('a', 'PENDING'), asset('b', 'PENDING')])).toEqual([]);
  });

  it('knows the three decisions and no others', () => {
    expect(ASSET_DECISIONS).toEqual(['PENDING', 'ACCEPTED', 'REJECTED']);
  });
});

describe('compensation', () => {
  const base = { tierKey: 'featured_event', eventPriceUsd: 79 };

  it('is not earned until a submission is accepted', () => {
    expect(compensationState({ ...base, status: 'SUBMITTED', assets: accepted(10) })).toBe(
      'not-earned',
    );
    expect(compensationState({ ...base, status: 'IN_REVIEW', assets: accepted(10) })).toBe(
      'not-earned',
    );
  });

  it('is owed once accepted with something usable', () => {
    expect(compensationState({ ...base, status: 'ACCEPTED', assets: accepted(8) })).toBe('owed');
  });

  it('is not owed for an acceptance with nothing usable', () => {
    // The compensation is for a rights-cleared package, not for having
    // submitted.
    expect(
      compensationState({ ...base, status: 'ACCEPTED', assets: [asset('a', 'REJECTED')] }),
    ).toBe('not-earned');
  });

  it('is paid once a person has sent it', () => {
    expect(
      compensationState({
        ...base,
        status: 'ACCEPTED',
        assets: accepted(8),
        paidAt: '2026-06-01T00:00:00Z',
      }),
    ).toBe('paid');
  });

  it('is void on a decline or a withdrawal', () => {
    expect(compensationState({ ...base, status: 'DECLINED', assets: accepted(8) })).toBe('void');
    expect(compensationState({ ...base, status: 'WITHDRAWN', assets: accepted(8) })).toBe('void');
  });

  it('is void on withdrawal even after it was paid', () => {
    // The record says a withdrawal happened; it does not pretend the money was
    // never sent, and nothing here claws anything back.
    expect(
      compensationState({
        ...base,
        status: 'WITHDRAWN',
        assets: accepted(8),
        paidAt: '2026-06-01T00:00:00Z',
      }),
    ).toBe('void');
  });
});

describe('meeting the tier', () => {
  it('counts accepted assets, not submitted ones', () => {
    // A tier is satisfied by what SharePix can actually use.
    expect(meetsTier('featured_event', accepted(8))).toBe(true);
    expect(
      meetsTier('featured_event', [...accepted(4), ...Array.from({ length: 6 }, (_, i) => asset(`r${i}`, 'REJECTED'))]),
    ).toBe(false);
  });

  it('is false for an unknown tier', () => {
    expect(meetsTier('free_money', accepted(50))).toBe(false);
  });
});

describe('the review checklist', () => {
  it('asks about the people who did not sign anything', () => {
    const joined = REVIEW_CHECKS.join(' ').toLowerCase();
    expect(joined).toMatch(/children|recognised|recognized/);
    expect(joined).toMatch(/logo|trademark/);
    expect(joined).toMatch(/private|funeral|hospital/);
  });

  it('is a list of questions for a person, not a score', () => {
    // None of these can be decided by software, and pretending otherwise would
    // put somebody's photograph on a homepage on the strength of a heuristic.
    for (const check of REVIEW_CHECKS) expect(check.trim().endsWith('?')).toBe(true);
  });
});
