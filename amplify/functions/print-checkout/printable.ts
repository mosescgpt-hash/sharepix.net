/**
 * Which stored object a print order may reference.
 *
 * Pure, no SDK and no I/O, so the rule is unit tested directly and still bundles
 * into the Lambda — the same split as stripe-checkout/pricing.ts and
 * media-url/access.ts.
 *
 * The check used to be `s3Key.startsWith('events/<eventId>/')`, which kept one
 * event's order from referencing another event's files but accepted any variant
 * underneath: `previews/` (a 1280px re-encode) and `thumbs/` (much smaller)
 * passed just as readily as the original. The gallery only ever sends the
 * original, so this was never hit in practice — but a crafted request could have
 * had a customer pay full price for an 8×10 printed from a thumbnail, and the
 * first anyone would know is when it arrived.
 *
 * Prints come from originals. Nothing else is printable.
 */

/** `events/<eventId>/photos/<file>` — the uploaded original, and only that. */
const ORIGINAL_PREFIX = (eventId: string) => `events/${eventId}/photos/`;

/** Videos can't be printed; reject them so an order never references one. */
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp|hevc)$/i;

export type KeyCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether this key may be printed as part of this event's order.
 *
 * Both messages are the ones a guest sees, so they say what to do rather than
 * what went wrong internally — every failure here is either a stale gallery or
 * a request that was not built by our UI.
 */
export function printableKey(key: string, eventId: string): KeyCheck {
  const trimmed = (key ?? '').trim();
  if (!trimmed || !eventId) {
    return { ok: false, reason: 'One of the photos does not belong to this event.' };
  }

  // Rejects a traversal attempt as well as another event's prefix: the segment
  // after `events/` has to match exactly, and `..` is not this event's id.
  if (!trimmed.startsWith(ORIGINAL_PREFIX(eventId))) {
    return { ok: false, reason: 'One of the photos does not belong to this event.' };
  }

  if (VIDEO_EXT.test(trimmed)) {
    return { ok: false, reason: 'Videos can’t be printed — choose photos only.' };
  }

  return { ok: true };
}
