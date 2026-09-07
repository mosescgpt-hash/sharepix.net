/**
 * Counting the bytes an event actually stores.
 *
 * ## Why here
 *
 * This is the only place in SharePix that knows an object's real size. Uploads
 * go browser → S3 directly, so no application server ever sees the bytes, and
 * the size the browser could report is a claim rather than a measurement. The
 * S3 event notification carries the true `object.size`, and this function
 * already reads it to enforce the per-file ceiling.
 *
 * A counter fed by the client would be a counter anyone could set to zero,
 * which is worse than no counter at all: it would read as authoritative.
 *
 * ## Idempotency
 *
 * S3 event notifications are at-least-once. The same object can arrive twice,
 * and a strippable original arrives twice by design — once as uploaded and once
 * as the sanitized rewrite.
 *
 * So the increment is gated on a conditional put to a per-key ledger row. The
 * put succeeds exactly once per key; a redelivery fails the condition and the
 * counter is left alone. The row is also what lets deletion subtract the right
 * number later rather than guessing.
 *
 * ## What is counted
 *
 * Exactly what gets mirrored to R2, decided by the same `mirrorDecision` the
 * copy uses. That is the honest rule: R2 is where reads are served from and
 * where the storage bill lands, so what is stored there is what an event costs.
 * A rejected upload is deleted from both stores and counted nowhere.
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
