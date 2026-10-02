/**
 * When an event's flagged photos call for an admin to look — the Lambda's copy.
 *
 * A byte-for-byte copy of lib/contentReview.ts below this comment. Amplify
 * functions cannot import from lib/, so it is copied, and
 * `__tests__/content-review.test.ts` fails if the two drift. Edit the lib/
 * file and re-copy.
 */

/** Flagged photos that put an event in review on their own. */
export const REVIEW_FLAGGED_COUNT = 10;

/** Share of an event's uploads that are flagged, for the second rule. */
export const REVIEW_FLAGGED_SHARE = 0.2;

/** The share rule needs at least this many flagged photos to apply. */
export const REVIEW_MIN_FLAGGED_FOR_SHARE = 5;

export interface ContentReviewFacts {
  /** Photos screening has flagged on this event, ever. */
  flaggedCount?: number | null;
  /** Photos accepted on this event, flagged ones included. */
  photoCount?: number | null;
  /** flaggedCount at the moment an admin last cleared the event, if ever. */
  contentReviewClearedCount?: number | null;
  /** Set when an admin closed the event; a closed event is not re-queued. */
  takenDownAt?: string | null;
}

/** Flagged photos since the event was last cleared. */
export function flaggedSinceCleared(facts: ContentReviewFacts | null | undefined): number {
  if (!facts) return 0;
  const flagged = Math.max(0, facts.flaggedCount ?? 0);
  const cleared = Math.max(0, facts.contentReviewClearedCount ?? 0);
  return Math.max(0, flagged - cleared);
}

/** Whether this event should be in front of an admin. */
export function needsContentReview(facts: ContentReviewFacts | null | undefined): boolean {
  if (!facts || facts.takenDownAt) return false;
  const fresh = flaggedSinceCleared(facts);
  if (fresh >= REVIEW_FLAGGED_COUNT) return true;
  // The share is measured over the whole event, but only once there are
  // enough fresh flags for it to mean something.
  if (fresh < REVIEW_MIN_FLAGGED_FOR_SHARE) return false;
  const photos = Math.max(0, facts.photoCount ?? 0);
  if (photos === 0) return false;
  return Math.max(0, facts.flaggedCount ?? 0) / photos >= REVIEW_FLAGGED_SHARE;
}

/** Flagged share of all uploads, 0–1, for display. */
export function flaggedShare(facts: ContentReviewFacts | null | undefined): number {
  const photos = Math.max(0, facts?.photoCount ?? 0);
  if (photos === 0) return 0;
  return Math.min(1, Math.max(0, facts?.flaggedCount ?? 0) / photos);
}
