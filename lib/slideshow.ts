// Relative imports (not the '@/' alias) so this stays importable from the Jest
// suite, matching lib/lifecycle.ts.
import { isVideoFilename } from './validation';
import type { QRPhoto } from './types';

/**
 * How long a photo waits before it can appear on the venue screen. This is the
 * moderation buffer: uploads are screened during this window, so nothing hits a
 * big screen the instant it lands. Deliberately short enough that guests still
 * see their photo "appear" while they're standing there.
 */
export const LIVE_BUFFER_SECONDS = 90;

/** How long each photo stays on screen. */
export const SLIDE_DURATION_MS = 7_000;

/** How often the screen asks for new photos. */
export const POLL_INTERVAL_MS = 15_000;

/**
 * How long a signed URL is reused before being re-signed. Signed URLs expire,
 * and a reception runs for hours, so cached URLs are refreshed well inside that
 * window rather than held for the whole event.
 */
export const URL_REFRESH_MS = 10 * 60 * 1_000;

/** Seconds since a photo was created, or null when it has no usable timestamp. */
function ageSeconds(photo: QRPhoto, now: Date): number | null {
  if (!photo.createdAt) return null;
  const created = new Date(photo.createdAt).getTime();
  if (!Number.isFinite(created)) return null;
  return (now.getTime() - created) / 1000;
}

/**
 * Whether a photo has cleared the moderation buffer. A photo with no usable
 * timestamp is treated as cleared — it is almost certainly an older upload, and
 * withholding it forever would be worse than showing it.
 */
export function hasClearedBuffer(
  photo: QRPhoto,
  now: Date = new Date(),
  bufferSeconds: number = LIVE_BUFFER_SECONDS,
): boolean {
  const age = ageSeconds(photo, now);
  return age === null ? true : age >= bufferSeconds;
}

/**
 * The photos the screen may show right now: approved, still images, and past the
 * buffer — oldest first, so the reception replays in the order it happened.
 *
 * Videos are excluded: the slideshow advances on a fixed timer, and a silent
 * clip cut off mid-scene reads as broken rather than intentional.
 */
export function slideshowEligible(
  photos: QRPhoto[],
  now: Date = new Date(),
  bufferSeconds: number = LIVE_BUFFER_SECONDS,
): QRPhoto[] {
  return photos
    .filter((photo) => photo.approved !== false)
    .filter((photo) => !isVideoFilename(photo.s3Key))
    .filter((photo) => hasClearedBuffer(photo, now, bufferSeconds))
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/**
 * Eligible photos the screen has not shown yet, oldest first. These get featured
 * as soon as they clear the buffer — the moment that makes the screen feel live
 * to the guest who just uploaded — before the loop resumes its normal cycle.
 */
export function newArrivals(eligible: QRPhoto[], seenIds: Set<string>): QRPhoto[] {
  return eligible.filter((photo) => !seenIds.has(photo.id));
}

/** Step forward through the reel, wrapping at the end. */
export function nextIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return (current + 1) % total;
}
