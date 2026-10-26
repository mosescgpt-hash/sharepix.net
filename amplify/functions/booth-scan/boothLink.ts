/**
 * A guest's booth code as a sharepix.net link (docs/booth-mode.md, "One code").
 *
 * The same QR code does two jobs:
 *   - the photographer scans or photographs it, and booth sorting reads the
 *     code inside the link exactly as before;
 *   - the guest points their own phone camera at it and lands on their
 *     private page for the event (their photos, their uploads, the gallery).
 *
 * Link: https://www.sharepix.net/b/<eventId>/<inner>
 *   inner = `t.<token>`             an online sign-up (the token, never an email)
 *   inner = `SPB1.<personId>.<blob>` an offline kiosk code (contact encrypted)
 * The kiosk only builds a string, so it still works with no connection.
 * Old codes (`sharepix-booth:<token>`, bare `SPB1.…`) still work everywhere.
 *
 * Byte-identical in lib/ and amplify/functions/{process-pro-photo,booth-scan,
 * booth-gallery}/ (functions cannot import from lib/). No dependencies.
 */

export const BOOTH_LINK_BASE = 'https://www.sharepix.net/b/';
const ONLINE_PREFIX = 'sharepix-booth:';
const OFFLINE_PREFIX = 'SPB1.';
const LINK = /^https?:\/\/(?:www\.)?sharepix\.net\/b\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9._-]{1,400})\/?$/i;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/** The link for a code. `payload` is an old-format code. */
export function boothLink(eventId: string, payload: string): string {
  const inner = payload.startsWith(ONLINE_PREFIX) ? `t.${payload.slice(ONLINE_PREFIX.length)}` : payload;
  return `${BOOTH_LINK_BASE}${encodeURIComponent(eventId)}/${inner}`;
}

/** The event id and old-format code inside a booth link, or null. */
export function readBoothLink(text: string): { eventId: string; payload: string } | null {
  const m = LINK.exec(text.trim());
  if (!m) return null;
  const inner = m[2];
  if (inner.startsWith('t.')) {
    const token = inner.slice(2);
    return TOKEN.test(token) ? { eventId: m[1], payload: `${ONLINE_PREFIX}${token}` } : null;
  }
  if (inner.startsWith(OFFLINE_PREFIX)) return { eventId: m[1], payload: inner };
  return null;
}

/**
 * The old-format code in whatever a QR code held: a booth link is unwrapped,
 * anything else is returned trimmed. A link made for another event gives
 * null, so it can never be read as this event's code.
 */
export function boothPayloadOf(text: string, eventId?: string): string | null {
  const link = readBoothLink(text);
  if (!link) return /^https?:/i.test(text.trim()) ? null : text.trim();
  if (eventId && link.eventId !== eventId) return null;
  return link.payload;
}
