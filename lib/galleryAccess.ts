/**
 * Gallery access — what a host can choose about guests viewing and downloading,
 * "Pause sharing", and "Replace QR code" (the guest link key), in the words the
 * settings card and the guest pages use.
 *
 * Nothing here decides access. The server does, in list-event-photos,
 * media-url and gallery-access; this mirrors their pure link-key rules (without
 * the crypto) so the UI can build links and say what is about to happen, and
 * __tests__/gallery-access.test.ts runs both over the same cases so they cannot
 * drift apart.
 */

/** A link key is 16 random bytes, base64url: 22 characters. */
export const LINK_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidLinkKey(key: unknown): key is string {
  return typeof key === 'string' && LINK_KEY_PATTERN.test(key);
}

/** What listEventPhotos throws while the host has sharing paused. */
export const SHARING_PAUSED_MESSAGE = 'SHARING_PAUSED';
/** What listEventPhotos throws when the QR code was replaced and this link is an old one. */
export const LINK_REQUIRED_MESSAGE = 'LINK_REQUIRED';

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? '');
}

export function isSharingPausedError(error: unknown): boolean {
  return textOf(error).includes(SHARING_PAUSED_MESSAGE);
}

export function isLinkRequiredError(error: unknown): boolean {
  return textOf(error).includes(LINK_REQUIRED_MESSAGE);
}

/** What a guest is told while sharing is paused. */
export const SHARING_PAUSED_NOTICE =
  'The host has paused sharing for now, so the gallery and downloads are closed. Photos you add still reach the host.';

/** What a guest is told when they open an old QR code or link. */
export const LINK_REPLACED_NOTICE =
  'This link or QR code has been replaced. Ask the host for the current one to see the gallery.';

export type GuestPage = 'gallery' | 'upload' | 'live';

const PAGE_SUFFIX: Record<GuestPage, string> = { gallery: '', upload: '/upload', live: '/live' };

/**
 * The path a guest link opens. The key rides in the URL fragment, which a
 * browser never sends to any server, so it is not in a request log, an
 * analytics event or a Referer header. A link without it still opens the upload
 * page, and shows the gallery only while the host has not replaced the QR code.
 */
export function guestLinkPath(eventId: string, key: string | null | undefined, page: GuestPage = 'upload'): string {
  const base = `/event/${encodeURIComponent(eventId)}${PAGE_SUFFIX[page]}`;
  return key && isValidLinkKey(key) ? `${base}#k=${key}` : base;
}

/** The key in a URL fragment such as `#k=AbC…`, or null. */
export function linkKeyFromFragment(hash: string | null | undefined): string | null {
  const match = /(?:^|[#&])k=([A-Za-z0-9_-]{22})(?:&|$)/.exec(hash ?? '');
  return match ? match[1] : null;
}

// --- A guest's link key, kept for the tab ----------------------------------

const memory = new Map<string, string>();
const storageKey = (eventId: string) => `spx-link-key:${eventId}`;

/** Remember the key a guest arrived with, for this tab only. */
export function rememberLinkKey(eventId: string, key: string): void {
  if (!isValidLinkKey(key)) return;
  memory.set(eventId, key);
  try {
    window.sessionStorage.setItem(storageKey(eventId), key);
  } catch {
    // Memory still holds it for this page's life.
  }
}

/** The key for this event held by this tab, else ''. */
export function getLinkKey(eventId: string): string {
  const held = memory.get(eventId);
  if (held) return held;
  try {
    const stored = typeof window === 'undefined' ? null : window.sessionStorage.getItem(storageKey(eventId));
    if (isValidLinkKey(stored)) {
      memory.set(eventId, stored);
      return stored;
    }
  } catch {
    // Storage blocked: behave as if nothing was stored.
  }
  return '';
}

export function forgetLinkKey(eventId: string): void {
  memory.delete(eventId);
  try {
    window.sessionStorage.removeItem(storageKey(eventId));
  } catch {
    // Nothing to clear.
  }
}

/**
 * Pick the key up from the address bar when the page opens (a scanned QR code
 * or a pasted link), and remember it. Returns the key now held, or ''.
 */
export function captureLinkKey(eventId: string, hash?: string): string {
  const fromUrl = linkKeyFromFragment(hash ?? (typeof window === 'undefined' ? '' : window.location.hash));
  if (fromUrl) rememberLinkKey(eventId, fromUrl);
  return fromUrl ?? getLinkKey(eventId);
}

/** For tests. */
export function resetLinkKeys(): void {
  memory.clear();
}
