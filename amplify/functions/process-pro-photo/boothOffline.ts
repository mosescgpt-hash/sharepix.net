/**
 * Offline booth ordering (docs/booth-mode.md, "Offline kiosk"). Pure.
 *
 * Divider scans and photos come off the SAME camera, so they are ordered by
 * the camera's own clock with no offset and no age limit: a cruise may upload
 * days later, and the camera's time zone does not matter when every reading
 * is from one clock. Those scans live under their own key (`…#camera`) so
 * they never mix with live scans, which are in true time.
 */
import { createHash } from 'node:crypto';
import { cameraClockMs } from './captureTime';
import { boothScanKey } from './boothMatch';
import type { BoothContact } from './boothSeal';

/** Scans recorded from QR dividers, in camera time. */
export function cameraScanKey(eventId: string, photographerId: string): string {
  return `${boothScanKey(eventId, photographerId)}#camera`;
}

/** The camera's reading as an ISO string, or null when it has none. */
export function cameraAtISO(captureText: string | null): string | null {
  if (!captureText) return null;
  const ms = cameraClockMs(captureText);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * The attendee row id for decrypted contact details. Same derivation as
 * online sign-up (booth-signup: sha256 of the email), so the same email
 * online and offline is one person. A phone-only signup hashes the phone.
 */
export function offlineAttendeeId(eventId: string, contact: BoothContact): string {
  const key = contact.email ?? contact.phone ?? '';
  return `${eventId}#${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
}

/** Recorded for a divider whose code could not be opened: it still ends the previous person's run. */
export const NOBODY = 'none';

/**
 * Deterministic scan id for a divider photo, so a retried upload writes the
 * same scan rather than a second one.
 */
export function dividerScanId(eventId: string, photographerId: string, uploadId: string): string {
  return `${eventId}#${photographerId}#div#${uploadId}`;
}

/**
 * Tie-break. Cameras record whole seconds, so a divider and the first portrait
 * can share a timestamp. Photos are matched to the latest divider AT OR BEFORE
 * their time, so a photo in the same second as a divider goes to the NEW
 * person — the code is always shot first. (Two dividers within one second
 * cannot be ordered; the fix-up screen flags nothing there, so don't.)
 */
export function belongsToDivider(photoAt: string, dividerAt: string, nextDividerAt: string | null): boolean {
  return photoAt >= dividerAt && (nextDividerAt === null || photoAt < nextDividerAt);
}
