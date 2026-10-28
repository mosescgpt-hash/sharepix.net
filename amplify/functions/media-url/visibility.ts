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
 * Whether a photo record should be returned to this caller, as far as its
 * status and kind go.
 *
 * Held videos are shown to nobody here. A guest's video waits for the host's
 * OK (`moderationStatus: 'held'`, set by createEventPhoto) because automated
 * screening covers stills and not video; the host decides in the dashboard,
 * which reads the Photo model directly and so still sees it. Once the host
 * approves it ('released') it is a normal gallery item for guests too.
 *
 * Videos that predate review have no verdict ('skipped' or none) and stay
 * host-only, as they always were, until the host approves them the same way.
 * A still is resized to a 1280px preview before it is ever served; a video
 * streams at full size every play, which is why a guest only ever gets one the
 * host has looked at and let through.
 *
 * Enforced here and in media-url, not in the gallery: hiding a video in the UI
 * while handing out its key or its URL would not be a gate at all.
 */
export function isVisibleTo(
  item: { s3Key?: string; eventOwner?: string; moderationStatus?: string },
  identity: CallerIdentity | null | undefined,
): boolean {
  if (item.moderationStatus === 'held') return false;
  if (!isVideoKey(item.s3Key)) return true;
  if (item.moderationStatus === 'released') return true;
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

/** The parts of a Photo row the visibility rules read. */
export interface PhotoRowFacts {
  id?: string;
  s3Key?: string;
  previewS3Key?: string;
  thumbS3Key?: string;
  approved?: boolean;
  moderationStatus?: string;
  eventOwner?: string;
  /** Present on booth photos; undefined for ordinary uploads. */
  boothMatch?: string;
  publishStatus?: string;
  boothDivider?: boolean;
  boothSegment?: string;
  uploaderId?: string;
  uploadedByUserId?: string;
}

export interface ViewContext {
  identity: CallerIdentity | null | undefined;
  audience: GalleryAudience;
  callerId: string;
  /** The host or an admin. */
  privileged: boolean;
  /** A valid download share's photo ids, else null. */
  shared: Set<string> | null;
}

/**
 * Whether one photo may be shown to this caller: the one rule behind both the
 * gallery listing and the signed URLs, so a photo that is not listed can never
 * be fetched either. Duplicated byte for byte in media-url (no cross-bundle
 * imports) and pinned that way by __tests__/gallery-access.test.ts.
 */
export function photoVisibleTo(row: PhotoRowFacts, ctx: ViewContext): boolean {
  if (row.approved === false) return false;
  // Booth photos: only published event or category photos, never a person's
  // (docs/booth-mode.md, "Shared gallery"). Belt and braces over `approved`.
  if (
    row.boothMatch !== undefined &&
    !(
      row.publishStatus === 'published' &&
      row.boothDivider !== true &&
      (row.boothSegment === 'event' || row.boothSegment === 'category')
    )
  ) {
    return false;
  }
  if (row.moderationStatus === 'flagged') return false;
  if (!isVisibleTo(row, ctx.identity)) return false;
  if (ctx.privileged) return true;
  if (ctx.shared) return ctx.shared.has(row.id ?? '');
  return audienceAllows(ctx.audience, row, ctx.callerId);
}

/**
 * What stands between a caller and the gallery, before any photo is looked at.
 *
 *   open     carry on to the per-photo rules
 *   paused   the host paused sharing: guests view and download nothing
 *   blocked  the host turned guest viewing off (or chose host-only)
 *   key      the host replaced the QR code and this caller has not got the
 *            new link (or never had one)
 *
 * The host and admins are never held up. A host's download share is the host
 * choosing particular photos for particular people, so it opens the gate, but
 * never while sharing is paused, and handlers drop a share made before the
 * latest QR replacement before they call this.
 */
export type GalleryGate = 'open' | 'paused' | 'blocked' | 'key';

export function galleryGateFor(input: {
  privileged: boolean;
  shared: boolean;
  paused: boolean;
  viewBlocked: boolean;
  audience: GalleryAudience;
  linkRequired: boolean;
  keyValid: boolean;
}): GalleryGate {
  if (input.privileged) return 'open';
  if (input.paused) return 'paused';
  if (input.shared) return 'open';
  if (input.viewBlocked || input.audience === 'host') return 'blocked';
  if (input.linkRequired && !input.keyValid) return 'key';
  return 'open';
}
