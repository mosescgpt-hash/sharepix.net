/**
 * The Lambda's copy of the photo challenge rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so these
 * rules exist more than once. Everything below this header is byte-identical
 * to lib/challenges/rules.ts and __tests__/challenges.test.ts fails if it
 * drifts. If you change one, re-copy it over the others.
 */

/** Active challenges an event may have at once. Inactive ones don't count. */
export const MAX_ACTIVE_CHALLENGES = 20;
/** Longest prompt, in characters. */
export const MAX_CHALLENGE_TEXT = 60;
/**
 * Abuse ceiling on rows per event, active or not. Hosts can switch prompts off
 * and on freely; this only stops a script filling a table.
 */
export const MAX_CHALLENGES_PER_EVENT = 100;

export interface ChallengeLike {
  id: string;
  text: string;
  order?: number | null;
  active?: boolean | null;
  createdAt?: string | null;
}

export type ChallengeCheck = { ok: true; text: string; order: number } | { ok: false; reason: string };

/** Control characters out, whitespace collapsed, trimmed. */
export function cleanChallengeText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function validateChallenge(input: { text?: unknown; order?: unknown }): ChallengeCheck {
  const text = cleanChallengeText(input.text);
  if (!text) return { ok: false, reason: 'Write a challenge first.' };
  if ([...text].length > MAX_CHALLENGE_TEXT) {
    return { ok: false, reason: `Keep it to ${MAX_CHALLENGE_TEXT} characters.` };
  }
  const n = Number(input.order);
  const order = Number.isFinite(n) ? Math.max(0, Math.min(10_000, Math.round(n))) : 0;
  return { ok: true, text, order };
}

/** Host's order, then oldest first, then id, so the list never jumps. */
export function sortChallenges<T extends ChallengeLike>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const oa = a.order ?? 0;
    const ob = b.order ?? 0;
    if (oa !== ob) return oa - ob;
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (ta !== tb && Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

export function activeChallenges<T extends ChallengeLike>(list: readonly T[]): T[] {
  return sortChallenges(list.filter((c) => c.active !== false));
}

/**
 * A random challenge, never the one on screen when there is another to show.
 * `random` is injectable so tests are deterministic.
 */
export function pickChallenge<T extends ChallengeLike>(
  list: readonly T[],
  currentId: string | null = null,
  random: () => number = Math.random,
): T | null {
  const pool = list.length > 1 ? list.filter((c) => c.id !== currentId) : [...list];
  if (pool.length === 0) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Challenges that have at least one photo, in the host's order: the gallery chips. */
export function challengesWithPhotos<T extends ChallengeLike>(
  list: readonly T[],
  photos: ReadonlyArray<{ challengeId?: string | null }>,
): Array<T & { count: number }> {
  const counts = photoCountsByChallenge(photos);
  return sortChallenges(list)
    .filter((c) => (counts.get(c.id) ?? 0) > 0)
    .map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
}

export function photoCountsByChallenge(
  photos: ReadonlyArray<{ challengeId?: string | null }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of photos) {
    if (p.challengeId) counts.set(p.challengeId, (counts.get(p.challengeId) ?? 0) + 1);
  }
  return counts;
}

/** The slideshow caption for a photo, or null. Captions are on unless switched off. */
export function challengeCaption(
  photo: { challengeId?: string | null },
  list: readonly ChallengeLike[],
  captionsEnabled: boolean | null | undefined,
): string | null {
  if (captionsEnabled === false || !photo.challengeId) return null;
  return list.find((c) => c.id === photo.challengeId)?.text ?? null;
}

export type PresetSetKey = 'party' | 'convention';

export const CHALLENGE_PRESETS: Record<PresetSetKey, { label: string; prompts: readonly string[] }> = {
  party: {
    label: 'Wedding or party',
    prompts: [
      'A selfie with someone you just met',
      'The best dance move of the night',
      'Your whole table in one shot',
      'Someone laughing hard',
      'The oldest and youngest guest together',
      'Your view right now',
      'A toast',
      'The detail everyone else missed',
      'Shoes off',
      'The last photo of the night',
    ],
  },
  convention: {
    label: 'Convention',
    prompts: [
      'Your favorite cosplay of the day',
      'A group shot with strangers in the same fandom',
      'The best prop you have seen',
      'Your haul so far',
      'The longest line you stood in',
      'A booth you would come back to',
      'Someone in a costume they made themselves',
      'You and your crew',
      'The most surprising thing you saw',
      'Your badge',
    ],
  },
};
