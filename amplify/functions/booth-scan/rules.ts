/**
 * The pure rules of booth scanning, kept apart so they are tested directly.
 */

/** Same key the photo processor queries; see process-pro-photo/boothMatch.ts. */
export function boothScanKey(eventId: string, photographerId: string): string {
  return `${eventId}#${photographerId}`;
}

/** A token as the sign-up function issues them (15 random bytes, base64url). */
export function isBoothToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

/**
 * The largest camera clock offset accepted: a day and a half covers every time
 * zone plus a badly set camera, and anything beyond it is a mistake.
 */
export const MAX_CLOCK_OFFSET_MS = 36 * 60 * 60 * 1000;

export function validClockOffset(offsetMs: number | null | undefined): offsetMs is number {
  return (
    typeof offsetMs === 'number' &&
    Number.isInteger(offsetMs) &&
    Math.abs(offsetMs) <= MAX_CLOCK_OFFSET_MS
  );
}
