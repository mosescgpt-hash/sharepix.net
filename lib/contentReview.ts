/**
 * When an event's flagged photos call for a person — the operator, not just
 * the host — to look at it.
 *
 * ## Why this exists
 *
 * Screening (docs/moderation.md) holds an explicit photo for the HOST to
 * review. That is the right default for one stray photo at a wedding, and it
 * is no protection at all when the host is the problem: an event whose whole
 * purpose is explicit or illegal material is reviewed by the person running
 * it. These thresholds are what turn "a host has some photos to look at" into
 * "SharePix should look at this event".
 *
 * ## The rule
 *
 * An event needs review when, since it was last cleared, it has
 *   - at least REVIEW_FLAGGED_COUNT flagged photos, or
 *   - at least REVIEW_MIN_FLAGGED_FOR_SHARE flagged photos AND they are at
 *     least REVIEW_FLAGGED_SHARE of all its uploads.
 *
 * A count alone misses a small event that is mostly explicit; a share alone
 * would put a three-photo event in the queue for one bad picture.
 *
 * ## A signal, never a verdict
 *
 * Screening looks for explicit adult content and is wrong in both directions:
 * a boudoir shoot or a private party trips it honestly. So crossing a
 * threshold puts the event in front of a person and sends one email. It never
 * closes anything by itself.
 *
 * Duplicated byte-for-byte into amplify/functions/create-event-photo, which
 * cannot import from lib/. `__tests__/content-review.test.ts` pins the copy.
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
