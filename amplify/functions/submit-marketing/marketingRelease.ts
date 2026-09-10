/**
 * The Lambda's copy of the Featured Events rules.
 *
 * Byte-identical to lib/marketingRelease.ts below the header; the drift guard
 * is in __tests__/marketing-submit.test.ts. This copy is the one that decides
 * what a submission means — the page is a courtesy, and this is the record.
 */
/**
 * The wording a customer accepted. Stamped on every submission.
 *
 * Change it when the release text changes, and never rewrite what an old
 * submission carries: a grant means what it said when it was given.
 */
export const RELEASE_VERSION = 'marketing-release-v1.0';

export interface MarketingTier {
  key: string;
  label: string;
  /** What the customer provides, in their words. */
  provides: string;
  /** Assets the tier expects, as an inclusive range. */
  minAssets: number;
  maxAssets: number;
  /** Does this tier ask for a written testimonial as well? */
  wantsTestimonial: boolean;
  /** Percentage of the event price refunded, and the cap in whole dollars. */
  refundPercent: number;
  refundCapUsd: number;
}

/**
 * The tiers, from the programme document.
 *
 * Only the two the document recommends starting with are offered. The other two
 * — a small photo pack, and a negotiated professional arrangement — are
 * deliberately absent: the first is not worth the review time at this volume,
 * and the second is a contract someone writes by hand rather than a button.
 */
export const MARKETING_TIERS: readonly MarketingTier[] = [
  {
    key: 'featured_event',
    label: 'Featured Event',
    provides: '8 to 15 photos you are happy for us to show, and a few sentences about your event',
    minAssets: 8,
    maxAssets: 15,
    wantsTestimonial: true,
    refundPercent: 25,
    refundCapUsd: 25,
  },
  {
    key: 'spotlight_story',
    label: 'Spotlight Story',
    provides:
      '10 to 20 photos, a testimonial, and a short conversation with us about how the event went',
    minAssets: 10,
    maxAssets: 20,
    wantsTestimonial: true,
    refundPercent: 50,
    refundCapUsd: 50,
  },
] as const;

export function tierByKey(key: string): MarketingTier | undefined {
  return MARKETING_TIERS.find((tier) => tier.key === key);
}

/**
 * What a tier is worth against a given event price, in whole dollars.
 *
 * Capped, and floored at zero. A comped event is worth nothing back because
 * nothing was paid — offering a refund on a free event would be inventing money
 * rather than returning it.
 */
export function refundValueUsd(tier: MarketingTier, eventPriceUsd: number): number {
  if (!(eventPriceUsd > 0)) return 0;
  const raw = Math.floor((eventPriceUsd * tier.refundPercent) / 100);
  return Math.max(0, Math.min(raw, tier.refundCapUsd));
}

/** Where a submission is. Transitions are pinned in `canTransition` below. */
export const SUBMISSION_STATUSES = [
  /** The host has been asked and has not answered. */
  'INVITED',
  /** Assets chosen, rights questions answered, release accepted. */
  'SUBMITTED',
  /** A person is looking at it. */
  'IN_REVIEW',
  /** Some or all assets accepted; compensation now owed. */
  'ACCEPTED',
  /** Nothing accepted. No compensation, and no assets enter the library. */
  'DECLINED',
  /** A rights question arrived. Use stops while it is looked at. */
  'PAUSED',
  /** Withdrawn by the customer. Use stops, permanently. */
  'WITHDRAWN',
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/**
 * Which moves are allowed.
 *
 * PAUSED and WITHDRAWN are reachable from anywhere a licence could be live,
 * because the document requires that use can be stopped promptly when a dispute
 * arrives. WITHDRAWN is terminal on purpose: a customer who takes their
 * permission back does not get moved on by an admin clicking through a queue.
 */
export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  if (from === to) return false;
  if (from === 'WITHDRAWN') return false;
  if (to === 'WITHDRAWN') return true;
  if (to === 'PAUSED') return from === 'ACCEPTED' || from === 'IN_REVIEW' || from === 'SUBMITTED';

  const allowed: Record<SubmissionStatus, SubmissionStatus[]> = {
    INVITED: ['SUBMITTED'],
    SUBMITTED: ['IN_REVIEW', 'DECLINED'],
    IN_REVIEW: ['ACCEPTED', 'DECLINED'],
    ACCEPTED: [],
    DECLINED: [],
    PAUSED: ['ACCEPTED', 'DECLINED'],
    WITHDRAWN: [],
  };
  return (allowed[from] ?? []).includes(to);
}

/**
 * What a reviewer confirms before anything is used.
 *
 * A checklist rather than an automated gate. None of these can be decided by
 * software — whether a child is identifiable, whether a logo is incidental,
 * whether a moment is somebody's grief — and pretending otherwise would put a
 * customer's photograph on a homepage on the strength of a heuristic.
 *
 * Face recognition is deliberately not part of this and is not built anywhere
 * in SharePix.
 */
export const REVIEW_CHECKS: readonly string[] = [
  'Is anyone in these photos identifiable who has not agreed to be shown?',
  'Are there children who can be recognised?',
  'Are there visible logos, artwork or trademarks that are not ours to publish?',
  'Is the moment private in a way the host may not have considered — a funeral, a hospital, a religious rite?',
  'Does the host plausibly hold the rights, or was this shot by a hired photographer?',
  'Would we be comfortable if the people in this photo saw it on our homepage?',
];

/** How each submitted asset was decided. */
export const ASSET_DECISIONS = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type AssetDecision = (typeof ASSET_DECISIONS)[number];

export interface SubmittedAsset {
  photoId: string;
  decision: AssetDecision;
  /** Why it was rejected, for the record. Never shown to the customer as-is. */
  note?: string | null;
}

/**
 * Only accepted assets may be used. Anything else is a photo somebody showed
 * us, which is not the same as a photo we may publish.
 */
export function usableAssets(assets: SubmittedAsset[]): SubmittedAsset[] {
  return assets.filter((asset) => asset.decision === 'ACCEPTED');
}

export interface CompensationFacts {
  status: SubmissionStatus;
  assets: SubmittedAsset[];
  tierKey: string;
  eventPriceUsd: number;
  /** Set when a person has actually sent it. */
  paidAt?: string | null;
}

export type CompensationState = 'not-earned' | 'owed' | 'paid' | 'void';

/**
 * What is owed, and whether it has been sent.
 *
 * A record of a decision, never an instruction. Nothing reads this and moves
 * money; a person does, from the admin queue, exactly like the refund ledger
 * and the research gift cards.
 */
export function compensationState(facts: CompensationFacts): CompensationState {
  if (facts.status === 'WITHDRAWN' || facts.status === 'DECLINED') return 'void';
  if (facts.paidAt) return 'paid';
  if (facts.status !== 'ACCEPTED') return 'not-earned';
  // Accepted with nothing usable is not a payable outcome: the compensation is
  // for a rights-cleared package, not for having submitted.
  return usableAssets(facts.assets).length > 0 ? 'owed' : 'not-earned';
}

/**
 * Does this submission meet the tier it was made under?
 *
 * Checked on the accepted assets rather than the submitted ones, so a tier is
 * satisfied by what SharePix can actually use.
 */
export function meetsTier(tierKey: string, assets: SubmittedAsset[]): boolean {
  const tier = tierByKey(tierKey);
  if (!tier) return false;
  return usableAssets(assets).length >= tier.minAssets;
}

/**
 * The one sentence that must appear wherever this is described.
 *
 * Kept here so the page, the email and the admin queue quote the same words
 * rather than three approximations of them.
 */
export const CONSENT_SUMMARY =
  'You are giving us permission to use only the photos you pick here, only for showing people what SharePix does. Your gallery stays private, and you can withdraw this at any time.';

/** What a customer is told they cannot grant, said plainly. */
export const RIGHTS_QUESTIONS: readonly string[] = [
  'These photos are yours to share, or you have the photographer’s permission.',
  'The people who can be recognised in them are happy to be shown.',
  'You understand we may not use all of them, and will tell you which we did.',
];
