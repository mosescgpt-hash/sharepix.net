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
 * Enforced here rather than in the gallery because guests hold S3 get
 * credentials for the bucket: hiding a video in the UI while still handing out
 * its object key would not be a gate at all. (They cannot list the bucket —
 * see amplify/storage/resource.ts — so a key they were never given is one they
 * would have to guess.)
 */
export function isVisibleTo(
  item: { s3Key?: string; eventOwner?: string },
  identity: CallerIdentity | null | undefined,
): boolean {
  if (!isVideoKey(item.s3Key)) return true;
  return isHostOrAdmin(identity, item.eventOwner);
}

/**
 * Who a host lets see the gallery. Absent means 'everyone' — every event made
 * before this setting existed, and every host who never touched it.
 *
 *   everyone  anyone with the link sees every approved photo (the default)
 *   own       each guest sees only what they uploaded themselves
 *   host      guests see nothing; their photos go to the host
 *
 * Mirrored in lib/galleryAudience.ts for the settings card;
 * __tests__/gallery-audience.test.ts keeps the two lists equal.
 */
export const GALLERY_AUDIENCES = ['everyone', 'own', 'host'] as const;
export type GalleryAudience = (typeof GALLERY_AUDIENCES)[number];

export function galleryAudienceOf(value: string | null | undefined): GalleryAudience {
  return (GALLERY_AUDIENCES as readonly string[]).includes(value ?? '')
    ? (value as GalleryAudience)
    : 'everyone';
}

/**
 * Who uploaded a photo, as stored on its row by createEventPhoto: the
 * uploader's Cognito sub when signed in, otherwise their identity-pool id —
 * the id a guest's browser keeps between visits.
 */
export function uploaderIdOf(identity: { sub?: string | null; cognitoIdentityId?: string | null } | null | undefined): string {
  return identity?.sub || identity?.cognitoIdentityId || '';
}

/**
 * Whether the host's gallery setting lets this caller see this photo.
 *
 * The host and admins see everything whatever the setting; that check is the
 * caller's, before this runs. For 'own', a photo matches on the uploader id
 * stored with it, or on the signed-in user id for uploads made while signed
 * in. A photo with neither — anything uploaded before uploaders were recorded —
 * matches nobody, which errs toward privacy: the host chose 'own' to keep
 * guests out of each other's photos, and an old photo shown to everyone would
 * break that.
 */
export function audienceAllows(
  audience: GalleryAudience,
  photo: { uploaderId?: string; uploadedByUserId?: string },
  callerId: string,
): boolean {
  if (audience === 'everyone') return true;
  if (audience === 'host' || !callerId) return false;
  return photo.uploaderId === callerId || photo.uploadedByUserId === callerId;
}
