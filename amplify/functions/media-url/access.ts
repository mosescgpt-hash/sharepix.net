/**
 * Who may be handed a signed URL for a stored object, and for which object.
 *
 * Pure predicates, no SDK and no I/O, so the rules are unit tested directly and
 * still bundle into the Lambda — the same split as list-event-photos/visibility.ts
 * and stripe-checkout/pricing.ts.
 *
 * This is the gate that replaces Amplify Storage's own access rules for reads
 * served out of R2. Amplify granted guests blanket read on `events/*` and let
 * the client choose the key; here the server decides, so the rules have to be
 * stated rather than assumed.
 */

/**
 * How many objects one request may ask to sign.
 *
 * A gallery loads in a single batch, and the widest read anywhere is the
 * 500-photo page limit in listEventPhotos, so this is that with room to spare.
 * The cap exists because `keys` is a client-supplied array: without it, one
 * request could ask for an unbounded amount of signing work.
 */
export const MAX_KEYS_PER_REQUEST = 600;

/**
 * The keys to actually work on: blanks dropped, duplicates collapsed, and no
 * more than `limit` of them. Deduping matters because a gallery legitimately
 * repeats a key — a photo with no preview falls back to its original, and two
 * photos in the same request can land on the same fallback.
 */
export function dedupeKeys(keys: (string | null | undefined)[], limit: number): string[] {
  const seen = new Set<string>();
  for (const raw of keys ?? []) {
    const key = (raw ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

const VIDEO_KEY = /\.(mp4|mov|webm|m4v|3gp)$/i;

/** `events/<eventId>/photos/...` — the uploaded original. */
const ORIGINAL = /^events\/([^/]+)\/photos\//;
/** `events/<eventId>/previews/...` and `.../thumbs/...` — browser re-encodes. */
const PREVIEW = /^events\/([^/]+)\/previews\//;
const THUMB = /^events\/([^/]+)\/thumbs\//;

/**
 * SharePix Pro. `pro/<eventId>/originals|previews|thumbnails/<uploadId>`.
 *
 * A professional original is a photographer's livelihood and is never signed
 * for anybody — not a guest, not the host, not an admin. It exists only so the
 * processor can read it, and it is usually deleted seconds later.
 */
const PRO_ORIGINAL = /^pro\/([^/]+)\/originals\//;
const PRO_PREVIEW = /^pro\/([^/]+)\/previews\//;
const PRO_THUMB = /^pro\/([^/]+)\/thumbnails\//;

export type Variant =
  | 'original'
  | 'preview'
  | 'thumb'
  | 'pro-original'
  | 'pro-preview'
  | 'pro-thumb'
  | 'unknown';

export function variantOf(key: string): Variant {
  if (ORIGINAL.test(key)) return 'original';
  if (PREVIEW.test(key)) return 'preview';
  if (THUMB.test(key)) return 'thumb';
  if (PRO_ORIGINAL.test(key)) return 'pro-original';
  if (PRO_PREVIEW.test(key)) return 'pro-preview';
  if (PRO_THUMB.test(key)) return 'pro-thumb';
  return 'unknown';
}

/** True for any professional key, whatever the variant. */
export function isProKey(key: string): boolean {
  return /^pro\//.test(key);
}

/**
 * The upload id in a professional key, which is also its Photo row id.
 *
 * The publish status a guest is gated on lives on the row, not in the key, so
 * this is how the handler knows which rows to read.
 */
export function proUploadIdOf(key: string): string {
  const match = key.match(/^pro\/[^/]+\/(?:originals|previews|thumbnails)\/(.+)$/);
  return match ? match[1] : '';
}

export function isVideoKey(key: string): boolean {
  return VIDEO_KEY.test(key);
}

/**
 * The event id a key belongs to, or '' when the key is not one of ours.
 *
 * Every request names both an event and a key, and nothing stops a caller
 * pairing one event's id with another event's key. Deriving the id from the key
 * itself is what makes that pairing detectable.
 */
export function eventIdOfKey(key: string): string {
  const match = key.match(/^events\/([^/]+)\//) ?? key.match(/^pro\/([^/]+)\//);
  return match ? match[1] : '';
}

export interface Caller {
  sub?: string | null;
  groups?: string[] | null;
}

export interface EventState {
  /** Amplify owner string, "<sub>::<loginId>". */
  owner: string;
  /** Host withheld downloads from guests. Absent/false = allowed. */
  guestDownloadsBlocked?: boolean;
  /** What guests may currently see: full, small, or nothing. */
  guestResolution: 'full' | 'small' | 'none';
}

export function isHostOrAdmin(caller: Caller | null | undefined, owner: string): boolean {
  if ((caller?.groups ?? [])?.includes('ADMINS')) return true;
  const sub = caller?.sub;
  if (!sub || !owner) return false;
  return owner.split('::')[0] === sub;
}

export type AccessDecision =
  | { allowed: true; host: boolean }
  | { allowed: false; reason: string };

/**
 * Decide whether to sign this key for this caller.
 *
 * The rules, in the order they are checked:
 *
 *  1. The key must belong to the event named in the request. Otherwise one
 *     event's id could be used to fetch another event's photos.
 *  2. The key must be a variant we recognise — no signing arbitrary paths.
 *  3. The host and admins get anything in their own event.
 *  4. Videos are host-only, matching the gallery: a still is served as a small
 *     preview, a video streams at full size every play.
 *  5. A guest gets nothing once the gallery has closed to them.
 *  6. A guest of an event whose host withheld downloads, or one past its
 *     full-resolution window, gets the thumbnail only — never the original.
 */
export function canSign({
  eventId,
  key,
  event,
  caller,
}: {
  eventId: string;
  key: string;
  event: EventState;
  caller: Caller | null | undefined;
}): AccessDecision {
  // Same message throughout: a caller must not be able to tell "wrong event"
  // from "not allowed" from "no such thing".
  const refuse = { allowed: false as const, reason: 'That file is not available.' };

  if (!eventId || eventIdOfKey(key) !== eventId) return refuse;

  const variant = variantOf(key);
  if (variant === 'unknown') return refuse;

  // A professional original is never signed, for anybody. Checked BEFORE the
  // host/admin branch on purpose: the host bought the event, not the
  // photographer's negatives, and an admin has no business handing one out
  // either. It exists so the processor can read it once, and the processor
  // reads it with its own IAM grant rather than through this function.
  if (variant === 'pro-original') return refuse;

  const host = isHostOrAdmin(caller, event.owner);
  if (host) return { allowed: true, host: true };

  // A professional preview or thumbnail is gated on the photo's publish
  // status, which lives on its row rather than in its key — so this function
  // cannot settle it alone. The handler drops unpublished ones before calling
  // here; `allowed` from this point means "allowed if published", and
  // proUploadIdOf is how the handler knows which rows to check.
  if (isVideoKey(key)) return refuse;
  if (event.guestResolution === 'none') return refuse;

  // Withheld downloads and the post-window low-resolution phase land in the
  // same place: the guest may have the thumbnail and nothing larger.
  const smallOnly = event.guestDownloadsBlocked === true || event.guestResolution === 'small';
  if (smallOnly && variant !== 'thumb') return refuse;

  return { allowed: true, host: false };
}
