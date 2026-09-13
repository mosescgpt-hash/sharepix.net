/**
 * The shape of an event code, without the dictionary that makes one.
 *
 * Deliberately knows nothing about the word list. Generating a code needs
 * 7,772 words; checking that a guest typed something code-shaped, tidying what
 * they typed, and printing it on a sign need only the shape — so the 87 KB
 * list lives in amplify/functions/create-event and there is exactly one copy
 * of it.
 *
 * ## Why words replaced characters
 *
 * Codes used to be six characters from a 31-character alphabet. That is fine
 * to store and miserable to use: it gets read aloud across a noisy room, and
 * "K7M2QX" is where somebody asks whether that was a J or a 7. Three words are
 * longer to type and far easier to get right, which is the trade that matters
 * for something whose whole job is being transcribed by a guest.
 *
 * It is also a bigger keyspace — 7,772³ ≈ 4.7 × 10¹¹ against 8.9 × 10⁸, about
 * 530× — though that is the smaller half of the argument and it is worth being
 * honest about why: the lookup endpoint can be brute-forced regardless, and
 * what actually stops that is rate limiting in front of it. The longer code
 * turns a feasible attack into an infeasible one; the throttle turns it into
 * no attack. Both, not either.
 */

/** Words in a generated code. */
export const EVENT_CODE_WORD_COUNT = 3;

/** What separates them, in storage and on screen. */
export const EVENT_CODE_SEPARATOR = '-';

/**
 * The shortest and longest a real code can be.
 *
 * EFF's words run 3 to 9 letters, so three of them plus two separators is
 * between 11 and 29 characters. Used to size inputs and to reject obvious
 * nonsense before a lookup is spent on it.
 */
export const EVENT_CODE_MIN_LENGTH = 3 * 3 + 2;
export const EVENT_CODE_MAX_LENGTH = 9 * 3 + 2;

/**
 * Codes issued before this changed: six characters, no separator.
 *
 * Still accepted. Nothing in the product rewrites a code once a sign has been
 * printed with it, and a guest holding an old card should not be told their
 * code is malformed because the format moved on.
 */
const LEGACY_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

const WORD_PATTERN = /^[a-z]{3,9}(-[a-z]{3,9}){2}$/;

/**
 * Tidy what somebody typed into what we would have stored.
 *
 * Guests paste from a text message, type with autocapitalise on, add a
 * trailing space, or use a different dash because their phone did. All of that
 * is the same code and none of it is their mistake.
 *
 * A legacy code is upper-cased; a word code is lower-cased. Which one it is
 * comes from whether it contains letters outside the legacy alphabet or a
 * separator, so the two cannot be confused.
 */
export function normalizeEventCode(input: string | null | undefined): string {
  const raw = (input ?? '')
    .trim()
    // Every dash a phone or a word processor might produce.
    .replace(/[‐-―−_\s]+/g, EVENT_CODE_SEPARATOR)
    .replace(/-+/g, EVENT_CODE_SEPARATOR)
    .replace(/^-|-$/g, '');

  if (!raw) return '';
  // A separator means it is meant to be words.
  if (raw.includes(EVENT_CODE_SEPARATOR)) return raw.toLowerCase();
  return raw.toUpperCase();
}

/** Whether a normalized code could exist. Says nothing about whether it does. */
export function isEventCodeShaped(code: string): boolean {
  return WORD_PATTERN.test(code) || LEGACY_PATTERN.test(code);
}

/** True for the six-character format issued before words. */
export function isLegacyEventCode(code: string): boolean {
  return LEGACY_PATTERN.test(code);
}

/**
 * How a code is shown to a person.
 *
 * Words as typed. A legacy code keeps its upper case, which is how it was
 * printed on whatever sign is already out in the world.
 */
export function formatEventCode(code: string): string {
  return normalizeEventCode(code);
}

/**
 * What to tell somebody whose code did not work.
 *
 * One message for "that is not code-shaped" and "no event has that code",
 * deliberately. Distinguishing them would tell a scanner which guesses were
 * closer, and it would not help an honest guest, who has the same job either
 * way: look at the card again.
 */
export const EVENT_CODE_NOT_FOUND =
  'We could not find an event with that code. Check it against the card or sign — it is three words separated by dashes.';
