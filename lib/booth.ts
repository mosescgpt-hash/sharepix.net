/**
 * Booth mode on the client: what an attendee's QR code carries, and the words
 * the sign-up page shows. See docs/booth-mode.md.
 */

/**
 * The QR payload: a prefix and the attendee's random token, never an email.
 * The prefix lets the photographer's scanner tell a booth code from any other
 * QR code it is pointed at.
 */
export const BOOTH_QR_PREFIX = 'sharepix-booth:';

export function boothQrPayload(token: string): string {
  return `${BOOTH_QR_PREFIX}${token}`;
}

/** The token from a scanned payload, or null when it is not a booth code. */
export function tokenFromBoothQr(payload: string): string | null {
  const value = payload.trim();
  if (!value.startsWith(BOOTH_QR_PREFIX)) return null;
  const token = value.slice(BOOTH_QR_PREFIX.length);
  return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
}

/** The consent line beside the checkbox. The host seeing photos is disclosed here. */
export const BOOTH_CONSENT_TEXT =
  'Email me the photos taken of me at this event. The event host can also see them.';

/** How long the kiosk shows a code before clearing for the next person. */
export const KIOSK_RESET_SECONDS = 90;

/** Where a personal phone keeps its code, so reopening the page shows it again. */
export function boothStorageKey(eventId: string): string {
  return `sharepix-booth:${eventId}`;
}

/** An attendee's private gallery link. Sent only to their email. */
export function boothGalleryPath(galleryKey: string): string {
  return `/booth/photos/${galleryKey}`;
}

/** The public sign-up link for an event, and its kiosk version. */
export function boothSignupPath(eventId: string, kiosk = false): string {
  return `/booth/${eventId}${kiosk ? '?kiosk=1' : ''}`;
}
