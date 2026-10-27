/**
 * PIN hashing and the guess limits. Pure (node:crypto only), so it is unit
 * tested directly. The handler does the table work.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_BYTES = 32;

/** `s1$<salt>$<hash>`, both base64. A fresh random salt per PIN. */
export function hashPin(pin: string, salt: Buffer = randomBytes(16)): string {
  const derived = scryptSync(pin, salt, KEY_BYTES, SCRYPT);
  return `s1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** Constant-time check of a typed PIN against a stored hash. */
export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  const [version, saltB64, hashB64, extra] = (stored ?? '').split('$');
  if (version !== 's1' || !saltB64 || !hashB64 || extra !== undefined) return false;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== KEY_BYTES) return false;
  const actual = scryptSync(pin, Buffer.from(saltB64, 'base64'), KEY_BYTES, SCRYPT);
  return timingSafeEqual(actual, expected);
}

/** A fresh random per-event signing key for access tokens. */
export function newTokenKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Wrong-PIN limits, counted in fixed windows.
 *
 * Only wrong guesses count (a right one is refunded), because a wedding venue
 * is often one shared address and its guests must not lock each other out by
 * all getting it right. Per address stops one phone hammering; per event stops
 * a spread-out attack on one gallery. Four digits is only 10,000 codes, so the
 * per-event limit is what protects it: 30 wrong guesses per 15 minutes is at
 * best ~2,900 a day, and the host is advised to use six digits.
 */
export const WINDOW_SECONDS = 15 * 60;
export const MAX_FAILURES_PER_IP = 8;
export const MAX_FAILURES_PER_EVENT = 30;

export function windowOf(now: number): number {
  return Math.floor(now / 1000 / WINDOW_SECONDS);
}

export function secondsLeftInWindow(now: number): number {
  const windowEnd = (windowOf(now) + 1) * WINDOW_SECONDS;
  return Math.max(1, Math.ceil(windowEnd - now / 1000));
}

export function ipCounterId(eventId: string, ip: string, window: number): string {
  return `pin#${eventId}#ip#${ip}#${window}`;
}

export function eventCounterId(eventId: string, window: number): string {
  return `pin#${eventId}#all#${window}`;
}
