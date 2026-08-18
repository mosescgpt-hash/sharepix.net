/**
 * Who may see what through the public photo query.
 *
 * Pure predicates, no AWS SDK and no I/O, so the rules can be unit tested
 * directly and still bundled into the Lambda — the same split as
 * `create-event-photo/moderation.ts`.
 */

/** Matches the extensions `create-event-photo` counts against the video limit. */
const VIDEO_KEY = /\.(mp4|mov|webm|m4v|3gp)$/i;

export function isVideoKey(s3Key: string | undefined): boolean {
  return VIDEO_KEY.test(s3Key ?? '');
}

/** The Amplify `owner`/`eventOwner` string is `"<sub>::<loginId>"`. */
function ownerSub(eventOwner: string): string {
  return eventOwner.split('::')[0];
}

export interface CallerIdentity {
  sub?: string | null;
  groups?: string[] | null;
}

/**
 * Whether this caller is the event's host, or a global admin.
 *
 * An empty `eventOwner` means nobody owns the photo, which must NOT match a
 * caller with no sub — otherwise an anonymous guest would be treated as the
 * host of every ownerless record.
 */
export function isHostOrAdmin(
  identity: CallerIdentity | null | undefined,
  eventOwner: string | undefined,
): boolean {
  if ((identity?.groups ?? []).includes('ADMINS')) return true;
  const sub = identity?.sub;
  const owner = eventOwner ?? '';
  if (!sub || owner === '') return false;
  return ownerSub(owner) === sub;
}

/**
 * Whether a photo record should be returned to this caller.
 *
 * Videos are **host-only**. A still is resized to a 1280px preview before it is
 * ever served; a video is streamed from S3 at full size on every play, which
 * makes guest playback by far the largest variable cost in the product. Hosts
 * still get every video — they are what the couple actually wants — but a
 * hundred guests re-watching each other's clips is a bill with no ceiling.
 *
 * Enforced here rather than in the gallery because guests hold S3 read
 * credentials for the bucket: hiding a video in the UI while still handing out
 * its object key would not be a gate at all.
 */
export function isVisibleTo(
  item: { s3Key?: string; eventOwner?: string },
  identity: CallerIdentity | null | undefined,
): boolean {
  if (!isVideoKey(item.s3Key)) return true;
  return isHostOrAdmin(identity, item.eventOwner);
}
