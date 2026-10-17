/**
 * Which moment a booth photo belongs to (docs/booth-mode.md).
 *
 * A photo goes to whoever was scanned most recently before it was taken. The
 * moment it was taken is the camera's capture time corrected by the clock
 * offset the photographer's app recorded; when either is missing or the result
 * is not believable, the upload time is used instead and the photo is marked
 * for the photographer to check.
 */

import { cameraClockMs } from './captureTime';

/** How far into the future a corrected capture time may be before it is distrusted. */
export const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

/** How old a corrected capture time may be before it is distrusted. */
export const MAX_PHOTO_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export type BoothMatchKind = 'capture' | 'upload';

/** Scans for one photographer at one event share this key, sorted by time. */
export function boothScanKey(eventId: string, photographerId: string): string {
  return `${eventId}#${photographerId}`;
}

export function photoInstant(input: {
  captureText: string | null;
  offsetMs: number | null;
  uploadedAtMs: number;
}): { atMs: number; match: BoothMatchKind } {
  const fallback = { atMs: input.uploadedAtMs, match: 'upload' as const };
  if (!input.captureText || input.offsetMs === null || !Number.isFinite(input.offsetMs)) {
    return fallback;
  }
  const camera = cameraClockMs(input.captureText);
  if (camera === null) return fallback;
  const atMs = camera - input.offsetMs;
  if (atMs > input.uploadedAtMs + MAX_FUTURE_SKEW_MS) return fallback;
  if (atMs < input.uploadedAtMs - MAX_PHOTO_AGE_MS) return fallback;
  return { atMs, match: 'capture' };
}
