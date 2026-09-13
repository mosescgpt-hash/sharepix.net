/**
 * SharePix Pro: what a professional photograph is, and who may see it.
 *
 * A wedding photographer shoots your event. Their photos appear in the live
 * gallery within minutes, so guests can see the real coverage while the party
 * is still happening — and the photographer still owns their work, still sells
 * their prints, and never hands a full-resolution original to a stranger.
 *
 * Those two goals pull against each other, and every rule below is where the
 * line got drawn.
 *
 * ## The defaults are the product
 *
 * A professional upload starts preview-only, un-downloadable, reduced, and
 * unpublished. Not because that is cautious, but because the opposite is
 * unrecoverable: a full-resolution original served once has been copied, and
 * no later setting takes it back. Anything that loosens these is a deliberate
 * act by the photographer who owns the photo, never a default and never the
 * host's decision.
 *
 * `defaultsFor` is the only way to create professional media state, so there
 * is no path that forgets one of them.
 *
 * ## What this module does not attempt
 *
 * DRM. A screenshot is always possible and pretending otherwise would mean
 * building something user-hostile that still fails. What is actually enforced
 * is narrower and holds: the bytes a guest can reach are a reduced-resolution
 * derivative, the original is never signed for a guest, and the download path
 * refuses professional media server-side rather than hiding a button.
 *
 * That last distinction is the whole security model. `canDownload` is called
 * by the UI *and* by the signing function, and the signing function is the one
 * that counts — see `mayServeToGuest`.
 */

/** Who produced a piece of media. Guests and professionals differ in every rule below. */
export const SOURCE_TYPES = ['guest', 'professional'] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export function isProfessional(sourceType: string | null | undefined): boolean {
  return sourceType === 'professional';
}

/**
 * The lifecycle of a professional photograph.
 *
 * `received` → `processing` → `awaiting_review` → `approved` → `published`,
 * with `rejected` reachable from anywhere and terminal.
 *
 * `approved` and `published` are deliberately separate. A photographer can
 * work through their review queue while the gallery is paused, and everything
 * they approved goes live the moment they resume — see `PublishGate`. Merging
 * the two would mean either approving blind or publishing unwillingly.
 */
export const PUBLISH_STATUSES = [
  'received',
  'processing',
  'awaiting_review',
  'approved',
  'published',
  'rejected',
] as const;

export type PublishStatus = (typeof PUBLISH_STATUSES)[number];

export function isPublishStatus(value: unknown): value is PublishStatus {
  return typeof value === 'string' && (PUBLISH_STATUSES as readonly string[]).includes(value);
}

/**
 * Which transitions are legal.
 *
 * Written as a table rather than as branching, so the illegal ones are visible
 * by their absence. Two that matter:
 *
 * - Nothing leaves `rejected`. A photographer who rejected a photo and then
 *   changed their mind re-approves it by a deliberate un-reject, which is a
 *   different action with its own audit trail — not a quiet status flip.
 * - `published` can go back to `approved` (unpublished) but never straight to
 *   `received`. Once served, it was served.
 */
const ALLOWED_TRANSITIONS: Record<PublishStatus, readonly PublishStatus[]> = {
  received: ['processing', 'rejected'],
  processing: ['awaiting_review', 'rejected'],
  awaiting_review: ['approved', 'rejected'],
  approved: ['published', 'rejected'],
  // Unpublishing returns it to approved; it stays approved work.
  published: ['approved', 'rejected'],
  rejected: [],
};

export function canTransition(from: PublishStatus, to: PublishStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** How a photographer wants new work handled. */
export const PUBLISHING_MODES = ['approve_first', 'auto_live', 'selected_only'] as const;

export type PublishingMode = (typeof PUBLISHING_MODES)[number];

/**
 * The default, and it is not a coin toss.
 *
 * `auto_live` publishes a photographer's unreviewed work to a room full of
 * guests. That is their reputation, on a photo they have not seen since the
 * shutter fired. It is offered because some photographers want it and know
 * what they are choosing; it is never what someone gets by not deciding.
 */
export const DEFAULT_PUBLISHING_MODE: PublishingMode = 'approve_first';

export function isPublishingMode(value: unknown): value is PublishingMode {
  return typeof value === 'string' && (PUBLISHING_MODES as readonly string[]).includes(value);
}

/**
 * Preview resolution, on the long edge.
 *
 * Big enough that the photographer's work looks like their work on a phone and
 * on a laptop; small enough that it is not a substitute for buying the file. A
 * preview so soft it embarrasses them would cost them the booking that sending
 * a photographer here was supposed to win.
 */
export const MIN_PREVIEW_LONG_EDGE = 1200;
export const MAX_PREVIEW_LONG_EDGE = 2400;
export const DEFAULT_PREVIEW_LONG_EDGE = 1800;

/** Clamp a requested resolution into the supported range. */
export function previewLongEdge(requested: number | null | undefined): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return DEFAULT_PREVIEW_LONG_EDGE;
  }
  return Math.min(MAX_PREVIEW_LONG_EDGE, Math.max(MIN_PREVIEW_LONG_EDGE, Math.round(requested)));
}

/** Thumbnail long edge. One size; the review grid and the gallery share it. */
export const THUMBNAIL_LONG_EDGE = 400;

export interface ProfessionalDefaults {
  sourceType: SourceType;
  publishStatus: PublishStatus;
  downloadAllowed: boolean;
  previewOnly: boolean;
  reducedResolutionEnabled: boolean;
  previewResolution: number;
}

/**
 * The state a new professional upload starts in.
 *
 * The single constructor for professional media state. A caller that built
 * this object by hand would eventually build one with `downloadAllowed: true`
 * — probably by copying a guest path — and that bug ships an original.
 *
 * `publishStatus` starts at `received` rather than `awaiting_review`: the
 * photo is not reviewable until a preview exists to review, and that is the
 * processor's job. A row that claimed to be awaiting review with no preview
 * would put an empty tile in the queue.
 */
export function defaultsFor(previewResolution?: number | null): ProfessionalDefaults {
  return {
    sourceType: 'professional',
    publishStatus: 'received',
    downloadAllowed: false,
    previewOnly: true,
    reducedResolutionEnabled: true,
    previewResolution: previewLongEdge(previewResolution),
  };
}

export interface MediaFacts {
  sourceType?: string | null;
  publishStatus?: string | null;
  downloadAllowed?: boolean | null;
  previewOnly?: boolean | null;
}

/**
 * Whether a guest may be served this media at all.
 *
 * **This is the gate that matters.** It is called by the URL-signing path, not
 * only by the gallery, because a rule enforced in the UI is a rule that holds
 * until somebody opens the network tab.
 *
 * Guest media is unchanged by any of this — it follows the event's own
 * settings and this function says so by returning true and letting the
 * existing lifecycle rules decide. Professional media has to be `published`,
 * and nothing else: `approved` is not published, `awaiting_review` is the
 * photographer's private queue, and `rejected` is work they decided a stranger
 * would never see.
 */
export function mayServeToGuest(media: MediaFacts): boolean {
  if (!isProfessional(media.sourceType)) return true;
  return media.publishStatus === 'published';
}

/** Which stored object a guest is allowed to be pointed at. */
export type ServableVariant = 'original' | 'preview' | 'thumbnail';

/**
 * The largest variant a guest may receive.
 *
 * Professional media resolves to `preview` and never to `original`, whatever
 * else is set on the row. The original is not merely un-downloadable — it is
 * never signed, so there is no URL for it to leak.
 */
export function guestVariantFor(media: MediaFacts): ServableVariant {
  if (isProfessional(media.sourceType)) return 'preview';
  return 'original';
}

/**
 * Whether a download button should appear, and whether a download may proceed.
 *
 * Both, from one function, deliberately. The alternative — a UI rule and a
 * server rule that are meant to agree — is how a hidden button ends up in
 * front of an endpoint that still serves the file.
 *
 * A professional photo is never downloadable by a guest, even if
 * `downloadAllowed` somehow says otherwise on the row. That belt-and-braces is
 * not redundancy for its own sake: `downloadAllowed` is a stored boolean, and
 * stored booleans get set by migrations, admin tools, and mistakes.
 */
export function canDownload(media: MediaFacts): boolean {
  if (isProfessional(media.sourceType)) return false;
  return media.downloadAllowed !== false;
}

export interface PublishGate {
  /** The photographer's Go Live switch for this event. */
  livePublishing: boolean;
  mode: PublishingMode;
}

/**
 * Whether an approved photo should go live right now.
 *
 * Paused means paused: approvals continue, processing continues, uploads
 * continue, and nothing reaches the gallery until the photographer says so.
 * That is the point of the control — a photographer mid-ceremony wants to
 * clear their queue without a half-edited set appearing on the screen behind
 * the altar.
 */
export function shouldPublishOnApproval(gate: PublishGate): boolean {
  if (!gate.livePublishing) return false;
  // selected_only publishes on an explicit publish action, never on approval.
  return gate.mode === 'approve_first' || gate.mode === 'auto_live';
}

/**
 * Whether processing may publish a photo without a human looking at it.
 *
 * Only `auto_live`, and only while live. Everything else lands in the queue.
 */
export function shouldAutoPublishOnProcessed(gate: PublishGate): boolean {
  return gate.mode === 'auto_live' && gate.livePublishing;
}

/** What the gallery prints on a professional tile. Short by design. */
export const PROFESSIONAL_BADGE = 'Professional Preview';

/**
 * The sentence under a professional photo, when there is room for one.
 *
 * Says what the guest is looking at and where the real file lives, without
 * apologising for the restriction or making the photographer look mean.
 */
export const PREVIEW_EXPLANATION =
  'Photos shown here are live previews from the event photographer. For final edited images, prints, or full-resolution downloads, visit the photographer’s gallery.';

export interface PhotographerLinks {
  businessName?: string | null;
  website?: string | null;
  contactUrl?: string | null;
  purchaseGalleryUrl?: string | null;
}

export interface GalleryLink {
  label: string;
  url: string;
}

/**
 * The photographer's links, in the order a guest wants them.
 *
 * Buying first: a guest looking at a photo they like is closer to purchase
 * than they will be at any later point. Only links that were actually
 * configured appear — an empty "Contact Photographer" is worse than no link,
 * and a `javascript:` or `data:` URL pasted into a profile field is not a link
 * at all, so only http(s) survives.
 */
export function galleryLinksFor(profile: PhotographerLinks): GalleryLink[] {
  const safe = (url: string | null | undefined): string | null => {
    const trimmed = (url ?? '').trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : null;
    } catch {
      // Not a URL at all. A profile field is host-supplied text and this is
      // rendered as an anchor, so anything unparseable is dropped rather than
      // passed through and hoped about.
      return null;
    }
  };

  const links: GalleryLink[] = [];
  const purchase = safe(profile.purchaseGalleryUrl);
  if (purchase) links.push({ label: 'Purchase photo', url: purchase });
  const site = safe(profile.website);
  if (site) links.push({ label: 'View photographer', url: site });
  const contact = safe(profile.contactUrl);
  if (contact) links.push({ label: 'Contact photographer', url: contact });
  return links;
}

/**
 * Where professional objects live — and why it is not under `events/`.
 *
 * The obvious layout is `events/<eventId>/professional/originals/`, and it is
 * unusable. `amplify/storage/resource.ts` grants `allow.guest.to(['read'])` on
 * `events/*`, and Amplify Gen 2 storage paths take a wildcard only at the end:
 * there is no way to write `events/*​/professional/originals/*` to carve an
 * exception back out. Anything placed under `events/` is readable by any guest
 * who has the key, full stop.
 *
 * So all three professional variants live under `pro/`, which has no access
 * rule at all. Nothing but a Lambda holding an explicit IAM grant can read
 * them, and every guest-facing URL is minted by the signing function after it
 * has checked `mayServeToGuest`. That is a stronger position than the guest
 * path holds today, and it is the right one for somebody else's livelihood.
 *
 * Previews are in there too, not just originals. A preview of a photo still
 * in the review queue — or one the photographer rejected — is exactly as
 * private as the original, and "the key is a UUID so nobody will guess it" is
 * not an access rule.
 */
export function professionalKeys(eventId: string, uploadId: string) {
  const base = `pro/${eventId}`;
  return {
    /** Private. Never signed for a guest, at any status. */
    original: `${base}/originals/${uploadId}`,
    /** Private storage, served to guests only through the signing gate. */
    preview: `${base}/previews/${uploadId}`,
    thumbnail: `${base}/thumbnails/${uploadId}`,
  };
}

/** True for any key under the professional prefix, whatever the variant. */
export function isProfessionalKey(key: string): boolean {
  return /^pro\//.test(key);
}

/** True for a key under the professional originals prefix specifically. */
export function isProfessionalOriginalKey(key: string): boolean {
  return /^pro\/[^/]+\/originals\//.test(key);
}
