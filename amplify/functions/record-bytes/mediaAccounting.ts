/**
 * The Lambda's copy of the media accounting rules.
 *
 * Byte-identical to lib/mediaAccounting.ts below the header; the drift guard is
 * in __tests__/byte-accounting.test.ts.
 */
/** Which counter an object's bytes belong to. */
export type MediaKind = 'photo' | 'video' | 'derived';

const DERIVED_KEY = /^events\/[^/]+\/(previews|thumbs)\//;
const ORIGINAL_KEY = /^events\/[^/]+\/photos\//;
const VIDEO_KEY = /\.(mp4|mov|webm|m4v|3gp)$/i;

/**
 * What kind of stored object this key is, or null if it is not ours.
 *
 * Previews and thumbnails are counted separately from what the guest uploaded
 * because we create them: they are a cost of the product's design rather than
 * of the host's use, and folding them into the photo total would make an
 * event's storage look 30% larger than what anyone actually sent.
 */
export function kindForKey(key: string): MediaKind | null {
  if (DERIVED_KEY.test(key)) return 'derived';
  if (!ORIGINAL_KEY.test(key)) return null;
  return VIDEO_KEY.test(key) ? 'video' : 'photo';
}

/** The event a key belongs to, or '' if the key is not ours. */
export function eventIdForKey(key: string): string {
  const match = /^events\/([^/]+)\//.exec(key);
  return match ? match[1] : '';
}

/** Which Event attribute a kind adds to. */
export function counterForKind(kind: MediaKind): string {
  if (kind === 'video') return 'videoBytes';
  if (kind === 'derived') return 'derivedBytes';
  return 'photoBytes';
}

/**
 * A size worth recording, or null.
 *
 * Rejects anything that is not a finite positive number. A NaN reaching a
 * DynamoDB ADD would corrupt the counter permanently, and a zero is not worth a
 * ledger row — an empty object is not storage anyone pays for.
 */
export function usableSize(size: unknown): number | null {
  const value = typeof size === 'number' ? size : Number(size);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}
