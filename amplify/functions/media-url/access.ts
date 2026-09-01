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

const VIDEO_KEY = /\.(mp4|mov|webm|m4v|3gp)$/i;

/** `events/<eventId>/photos/...` — the uploaded original. */
const ORIGINAL = /^events\/([^/]+)\/photos\//;
/** `events/<eventId>/previews/...` and `.../thumbs/...` — browser re-encodes. */
const PREVIEW = /^events\/([^/]+)\/previews\//;
const THUMB = /^events\/([^/]+)\/thumbs\//;

export type Variant = 'original' | 'preview' | 'thumb' | 'unknown';

export function variantOf(key: string): Variant {
  if (ORIGINAL.test(key)) return 'original';
  if (PREVIEW.test(key)) return 'preview';
  if (THUMB.test(key)) return 'thumb';
  return 'unknown';
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
  const match = key.match(/^events\/([^/]+)\//);
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

  const host = isHostOrAdmin(caller, event.owner);
  if (host) return { allowed: true, host: true };

  if (isVideoKey(key)) return refuse;
  if (event.guestResolution === 'none') return refuse;

  // Withheld downloads and the post-window low-resolution phase land in the
  // same place: the guest may have the thumbnail and nothing larger.
  const smallOnly = event.guestDownloadsBlocked === true || event.guestResolution === 'small';
  if (smallOnly && variant !== 'thumb') return refuse;

  return { allowed: true, host: false };
}
