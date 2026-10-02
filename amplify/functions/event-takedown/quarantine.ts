/**
 * Where a closed event's media goes, and how it comes back.
 *
 * A closed event's objects move from `events/<eventId>/…` to
 * `quarantine/events/<eventId>/…`. The storage rules grant guests and hosts
 * read on `events/*` only, so a key someone saved before the closure stops
 * working the moment the object moves; `quarantine/*` is readable by admins
 * and nobody else. The prefix keeps the original path whole underneath it, so
 * restoring is stripping it, with no lookup table to lose.
 *
 * Moving out of `events/` also takes the objects out from under the bucket's
 * expiry rule (which is scoped to that prefix) and out of the upload trigger's
 * reach (it only acts on `events/` keys), so preserved content is neither
 * expired nor reprocessed.
 *
 * Pure, so the mapping is tested directly.
 */

export const QUARANTINE_PREFIX = 'quarantine/';

/** The live prefix for one event's media. */
export function eventPrefix(eventId: string): string {
  return `events/${eventId}/`;
}

/** The quarantined prefix for one event's media. */
export function quarantinePrefix(eventId: string): string {
  return `${QUARANTINE_PREFIX}${eventPrefix(eventId)}`;
}

/**
 * The quarantined key for a live key of this event, or null for a key that is
 * not this event's — so a stray key on a row can never be moved into, or out
 * of, another event's space.
 */
export function quarantineKeyFor(key: string, eventId: string): string | null {
  if (!eventId || !key.startsWith(eventPrefix(eventId))) return null;
  return `${QUARANTINE_PREFIX}${key}`;
}

/** The live key for a quarantined key of this event, or null. */
export function restoredKeyFor(key: string, eventId: string): string | null {
  if (!eventId || !key.startsWith(quarantinePrefix(eventId))) return null;
  return key.slice(QUARANTINE_PREFIX.length);
}

/** The Photo row fields that hold object keys. */
export const PHOTO_KEY_FIELDS = ['s3Key', 'previewS3Key', 'thumbS3Key'] as const;

/**
 * The key fields of one Photo row, remapped, keeping only the ones that
 * change. Empty when nothing on the row needs rewriting, which is what makes
 * a second run over a half-finished event a no-op for rows already done.
 */
export function remapPhotoKeys(
  row: Partial<Record<(typeof PHOTO_KEY_FIELDS)[number], string | null | undefined>>,
  map: (key: string) => string | null,
): Partial<Record<(typeof PHOTO_KEY_FIELDS)[number], string>> {
  const out: Partial<Record<(typeof PHOTO_KEY_FIELDS)[number], string>> = {};
  for (const field of PHOTO_KEY_FIELDS) {
    const key = row[field];
    if (!key) continue;
    const next = map(key);
    if (next && next !== key) out[field] = next;
  }
  return out;
}
