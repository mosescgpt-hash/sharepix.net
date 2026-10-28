/**
 * The rules for "pause sharing" and the replaceable guest link key, shared by
 * every function that has to honour them.
 *
 * Byte-identical in gallery-access, media-url, list-event-photos and
 * booth-gallery (Amplify functions take no cross-bundle imports), and pinned
 * that way by __tests__/gallery-access.test.ts. lib/galleryAccess.ts mirrors
 * the pure rules for the browser and the same test keeps them equal.
 *
 * What is secret here is the per-event link key, which lives in the
 * GalleryLink table and nowhere else a guest can read.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** A link key is 16 random bytes, base64url: 22 characters. */
export const LINK_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidLinkKey(key: unknown): key is string {
  return typeof key === 'string' && LINK_KEY_PATTERN.test(key);
}

/**
 * Whether a key a guest presented is the event's current one. Both sides are
 * hashed first so the comparison is constant-time whatever their lengths.
 */
export function linkKeyMatches(stored: string | null | undefined, given: string | null | undefined): boolean {
  if (!isValidLinkKey(stored) || !isValidLinkKey(given)) return false;
  const a = createHash('sha256').update(stored).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

/** The parts of an Event row these rules read. */
export interface SharingFacts {
  /** The host paused guest viewing and downloading. */
  sharingPaused?: boolean | null;
  /** A guest link key exists, so guests must present it. */
  galleryLinkSet?: boolean | null;
  /** When the host last replaced the QR code. Absent: never. */
  linkRotatedAt?: string | null;
}

export function sharingPaused(facts: SharingFacts): boolean {
  return facts.sharingPaused === true;
}

/**
 * Whether guests must present a link key. Only once the host has replaced the
 * QR code at least once: an event that never did has no key and nothing to ask
 * for, so nothing made before this existed is locked.
 */
export function linkRequired(facts: SharingFacts): boolean {
  return facts.galleryLinkSet === true;
}

/**
 * Whether a download share link is still good after the host replaced the QR
 * code. A share made before the replacement is void. A share with no creation
 * time cannot be placed, so it is void too once a replacement has happened.
 */
export function shareIsCurrent(shareCreatedAt: string | null | undefined, facts: SharingFacts): boolean {
  if (!facts.linkRotatedAt) return true;
  const rotated = Date.parse(facts.linkRotatedAt);
  if (!Number.isFinite(rotated)) return true;
  const created = Date.parse(shareCreatedAt ?? '');
  return Number.isFinite(created) && created >= rotated;
}
