/**
 * Booth mode on the client: what an attendee's QR code carries, and the words
 * the sign-up page shows. See docs/booth-mode.md.
 */
import { boothLink, boothPayloadOf } from './boothLink';

/**
 * The QR payload: a prefix and the attendee's random token, never an email.
 * The prefix lets the photographer's scanner tell a booth code from any other
 * QR code it is pointed at.
 */
export const BOOTH_QR_PREFIX = 'sharepix-booth:';

export function boothQrPayload(token: string, eventId?: string): string {
  const code = `${BOOTH_QR_PREFIX}${token}`;
  // A sharepix.net link: the photographer's scan reads the token inside it,
  // and the guest's own camera opens their private page (lib/boothLink.ts).
  return eventId ? boothLink(eventId, code) : code;
}

/** The token from a scanned payload, or null when it is not a booth code. */
export function tokenFromBoothQr(payload: string): string | null {
  const value = boothPayloadOf(payload) ?? '';
  // A start or stop code: the server checks its signature.
  if (/^SPK1\.[ecs]\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return value;
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

/**
 * The texting consent beside the cell-number box. Exact wording, approved for
 * toll-free registration (SMS_SETUP.md) — change it there too if it changes.
 */
export function boothSmsConsentText(eventName: string | null | undefined): string {
  const event = (eventName ?? '').trim() || 'this event';
  return `Text me a link to my photos from ${event}. Msg & data rates may apply. Reply STOP to opt out.`;
}

/** The offline kiosk (docs/booth-mode.md, "Offline kiosk"). */
export function boothKioskPath(eventId: string): string {
  return `/booth/kiosk/${eventId}`;
}

/**
 * What the offline kiosk keeps between people: the event name (to work after
 * a reload with no signal), how many codes it made, and their random person
 * ids. NEVER a name, email or phone — those exist only in the sealed code.
 */
export interface KioskState {
  eventName: string;
  count: number;
  personIds: string[];
}

export function kioskStorageKey(eventId: string): string {
  return `sharepix-kiosk:${eventId}`;
}

/** Parse stored kiosk state, dropping anything that is not exactly the allowed shape. */
export function parseKioskState(raw: string | null): KioskState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<KioskState>;
    if (typeof v.eventName !== 'string' || typeof v.count !== 'number' || !Array.isArray(v.personIds)) return null;
    return {
      eventName: v.eventName.slice(0, 120),
      count: Math.max(0, Math.floor(v.count)),
      personIds: v.personIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{12}$/.test(id)).slice(-5000),
    };
  } catch {
    return null;
  }
}
