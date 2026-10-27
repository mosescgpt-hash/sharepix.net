/**
 * The gallery PIN rules and the access token, shared by every function that
 * has to honour them.
 *
 * Byte-identical in gallery-access, media-url and list-event-photos (Amplify
 * functions take no cross-bundle imports), and pinned that way by
 * __tests__/gallery-pin.test.ts. lib/galleryAccess.ts mirrors the pure rules
 * for the browser, without the crypto, and the same test keeps them equal.
 *
 * Nothing here is secret except the per-event `tokenKey` passed in, which
 * lives in the GalleryPin table and nowhere else.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** A PIN is 4 to 6 digits, nothing else. */
export const PIN_PATTERN = /^\d{4,6}$/;
export const DEFAULT_PIN_AUTO_DAYS = 30;
export const MIN_PIN_AUTO_DAYS = 1;
export const MAX_PIN_AUTO_DAYS = 365;
/** How long a PIN token lasts. Short on purpose; a guest simply enters it again. */
export const TOKEN_TTL_SECONDS = 4 * 60 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_PATTERN.test(pin);
}

export const PIN_MODES = ['auto', 'on', 'off'] as const;
export type PinMode = (typeof PIN_MODES)[number];

/** Absent or unknown reads as 'auto', the default. */
export function pinModeOf(value: string | null | undefined): PinMode {
  return (PIN_MODES as readonly string[]).includes(value ?? '') ? (value as PinMode) : 'auto';
}

/** Whole days, clamped; absent or nonsense reads as the default 30. */
export function pinAutoDaysOf(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PIN_AUTO_DAYS;
  return Math.min(MAX_PIN_AUTO_DAYS, Math.max(MIN_PIN_AUTO_DAYS, Math.round(value)));
}

/** The parts of an Event row the PIN rule reads. */
export interface PinFacts {
  galleryPinSet?: boolean | null;
  galleryPinMode?: string | null;
  galleryPinAutoDays?: number | null;
  /** The event date, as the host typed it (YYYY-MM-DD). */
  date?: string | null;
  createdAt?: string | null;
}

/**
 * When 'auto' mode switches the PIN on: the event date plus the chosen days,
 * counted from the start of the event day (UTC). With no usable date the
 * creation time is used, and with neither, null — which pinRequired treats as
 * "already on", because a PIN the host went to the trouble of setting must not
 * quietly never apply.
 */
export function pinStartsAt(facts: PinFacts): number | null {
  const base = Date.parse(facts.date ?? '') || Date.parse(facts.createdAt ?? '');
  if (!Number.isFinite(base)) return null;
  return base + pinAutoDaysOf(facts.galleryPinAutoDays) * DAY_MS;
}

/**
 * Whether guests need the PIN right now. Only ever true once a PIN exists:
 * an event with no PIN has nothing to ask for, and locking its guests out
 * behind a code nobody knows would be a bug, not security.
 */
export function pinRequired(facts: PinFacts, now: number = Date.now()): boolean {
  if (facts.galleryPinSet !== true) return false;
  const mode = pinModeOf(facts.galleryPinMode);
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  const starts = pinStartsAt(facts);
  return starts === null ? true : now >= starts;
}

function b64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signature(tokenKey: string, eventId: string, expiresAtSeconds: number): string {
  return b64url(createHmac('sha256', tokenKey).update(`gp1.${eventId}.${expiresAtSeconds}`).digest());
}

/** `<expiry seconds>.<signature>`; bound to one event and to its current key. */
export function signAccessToken(
  tokenKey: string,
  eventId: string,
  now: number = Date.now(),
  ttlSeconds: number = TOKEN_TTL_SECONDS,
): { token: string; expiresAt: string } {
  const expires = Math.floor(now / 1000) + ttlSeconds;
  return {
    token: `${expires}.${signature(tokenKey, eventId, expires)}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

export function verifyAccessToken(
  tokenKey: string,
  eventId: string,
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!tokenKey || !eventId || typeof token !== 'string' || token.length > 200) return false;
  const [expiry, sig, extra] = token.split('.');
  if (!expiry || !sig || extra !== undefined || !/^\d{1,12}$/.test(expiry)) return false;
  const expires = Number(expiry);
  if (expires * 1000 <= now) return false;
  const expected = Buffer.from(signature(tokenKey, eventId, expires));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
