/**
 * Gallery access — what a host can choose about guests viewing and downloading,
 * the optional gallery PIN, and the PIN links, in the words the settings card
 * and the guest pages use.
 *
 * Nothing here decides access. The server does, in list-event-photos,
 * media-url and gallery-access; this mirrors their pure PIN rules (without the
 * crypto) so the UI can say what is about to happen, and
 * __tests__/gallery-pin.test.ts runs both over the same cases so they cannot
 * drift apart.
 */

export const PIN_PATTERN = /^\d{4,6}$/;
export const DEFAULT_PIN_AUTO_DAYS = 30;
export const MIN_PIN_AUTO_DAYS = 1;
export const MAX_PIN_AUTO_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

export type PinMode = 'auto' | 'on' | 'off';
export const PIN_MODES: PinMode[] = ['auto', 'on', 'off'];

export function pinModeOf(value: string | null | undefined): PinMode {
  return (PIN_MODES as string[]).includes(value ?? '') ? (value as PinMode) : 'auto';
}

export function pinAutoDaysOf(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PIN_AUTO_DAYS;
  return Math.min(MAX_PIN_AUTO_DAYS, Math.max(MIN_PIN_AUTO_DAYS, Math.round(value)));
}

export interface PinFacts {
  galleryPinSet?: boolean | null;
  galleryPinMode?: string | null;
  galleryPinAutoDays?: number | null;
  date?: string | null;
  createdAt?: string | null;
}

export function pinStartsAt(facts: PinFacts): number | null {
  const base = Date.parse(facts.date ?? '') || Date.parse(facts.createdAt ?? '');
  if (!Number.isFinite(base)) return null;
  return base + pinAutoDaysOf(facts.galleryPinAutoDays) * DAY_MS;
}

export function pinRequired(facts: PinFacts, now: number = Date.now()): boolean {
  if (facts.galleryPinSet !== true) return false;
  const mode = pinModeOf(facts.galleryPinMode);
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  const starts = pinStartsAt(facts);
  return starts === null ? true : now >= starts;
}

/** The date 'auto' mode switches the PIN on, for the settings card. Null when it has none. */
export function pinStartsOn(facts: PinFacts): Date | null {
  const at = pinStartsAt(facts);
  return at === null ? null : new Date(at);
}

/** The message listEventPhotos throws when the PIN is on and no valid token came with the call. */
export const PIN_REQUIRED_MESSAGE = 'PIN_REQUIRED';

export function isPinRequiredError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return text.includes(PIN_REQUIRED_MESSAGE);
}

/**
 * The path a PIN link opens. The PIN rides in the URL fragment, which a browser
 * never sends to any server, so it is not in a request log, an analytics event
 * or a Referer header. The gallery reads it, uses it once and removes it from
 * the address bar. A link without it asks for the PIN, which is the point of
 * forwarding a plain link.
 */
export function pinLinkPath(eventId: string, pin: string | null, page: 'gallery' | 'live' = 'gallery'): string {
  const base = `/event/${encodeURIComponent(eventId)}${page === 'live' ? '/live' : ''}`;
  return pin && isValidPin(pin) ? `${base}#pin=${pin}` : base;
}

/** The PIN in a URL fragment such as `#pin=123456`, or null. */
export function pinFromFragment(hash: string | null | undefined): string | null {
  const match = /(?:^|[#&])pin=(\d{4,6})(?:&|$)/.exec(hash ?? '');
  return match ? match[1] : null;
}

// --- A guest's access token, kept for the tab ------------------------------

interface StoredToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

const memory = new Map<string, StoredToken>();
const sessionPins = new Map<string, string>();
const storageKey = (eventId: string) => `spx-pin-token:${eventId}`;
/** Renew this long before expiry so a slideshow never shows a PIN prompt. */
export const TOKEN_RENEW_MARGIN_MS = 10 * 60 * 1000;

function readStored(eventId: string): StoredToken | null {
  const held = memory.get(eventId);
  if (held) return held;
  try {
    const raw = typeof window === 'undefined' ? null : window.sessionStorage.getItem(storageKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed?.token === 'string' && typeof parsed.expiresAt === 'number') {
      memory.set(eventId, parsed);
      return parsed;
    }
  } catch {
    // Storage blocked or corrupt: behave as if nothing was stored.
  }
  return null;
}

/** The token for this event if it is still good, else ''. */
export function getAccessToken(eventId: string, now: number = Date.now()): string {
  const stored = readStored(eventId);
  return stored && stored.expiresAt > now ? stored.token : '';
}

/** True when there is a token but it will lapse within the renew margin. */
export function accessTokenNeedsRenewal(eventId: string, now: number = Date.now()): boolean {
  const stored = readStored(eventId);
  return Boolean(stored) && (stored as StoredToken).expiresAt - now < TOKEN_RENEW_MARGIN_MS;
}

export function setAccessToken(eventId: string, token: string, expiresAtIso: string): void {
  const expiresAt = Date.parse(expiresAtIso);
  if (!token || !Number.isFinite(expiresAt)) return;
  const value = { token, expiresAt };
  memory.set(eventId, value);
  try {
    window.sessionStorage.setItem(storageKey(eventId), JSON.stringify(value));
  } catch {
    // Memory still holds it for this page's life.
  }
}

export function clearAccessToken(eventId: string): void {
  memory.delete(eventId);
  try {
    window.sessionStorage.removeItem(storageKey(eventId));
  } catch {
    // Nothing to clear.
  }
}

/** For tests. */
export function resetAccessTokens(): void {
  memory.clear();
  sessionPins.clear();
}

// --- The PIN itself, held in memory only ------------------------------------

/**
 * Keep the PIN a viewer just entered for the life of this page, so a slideshow
 * can renew its own access token. Never written to storage or a URL.
 */
export function rememberSessionPin(eventId: string, pin: string): void {
  if (isValidPin(pin)) sessionPins.set(eventId, pin);
}

export function sessionPinFor(eventId: string): string {
  return sessionPins.get(eventId) ?? '';
}
