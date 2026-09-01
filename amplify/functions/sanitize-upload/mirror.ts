/**
 * Which uploaded objects get copied to Cloudflare R2, and when.
 *
 * SharePix keeps AWS as the write path — uploads land in S3, and this function
 * vets them there — but serves reads from R2, where egress is free. That saves
 * roughly $24 on a Premium event's bandwidth, which is most of the cost of
 * running one. The copy itself is the only new AWS egress, paid once per byte.
 *
 * The timing is the part that matters, and it is why this is a separate,
 * tested module rather than an `if` in the handler.
 *
 * An uploaded JPEG or HEIC has its location data stripped in place, and that
 * rewrite fires a SECOND ObjectCreated event carrying `sanitized: 'true'`.
 * Copying on the first event would put the ORIGINAL — GPS and all — into R2,
 * where it would then be served to guests. Everything we strip would leak. So a
 * strippable original is deliberately skipped on its first pass and mirrored
 * only on the sanitized rewrite.
 *
 * Objects that are rejected (disguised bytes, oversize) are never mirrored, and
 * anything already in R2 for that key is removed.
 */

/** Uploaded originals: `events/<eventId>/photos/...`. These get vetted. */
const ORIGINAL_KEY = /^events\/[^/]+\/photos\//;

/**
 * Browser-generated variants: `events/<eventId>/previews/...` and `.../thumbs/`.
 * These are re-encoded from the original by canvas, which carries no metadata
 * across, so they need no vetting — but they are what the gallery actually
 * serves, so they are the most important thing to have in R2.
 */
const DERIVED_KEY = /^events\/[^/]+\/(previews|thumbs)\//;

export interface MirrorInput {
  /** The decoded S3 object key. */
  key: string;
  /** True once the vetting step has rejected this upload. */
  rejected?: boolean;
  /**
   * True when the object carries `sanitized: 'true'` — i.e. this event is the
   * rewrite that stripping produced, not the guest's original upload.
   */
  sanitized?: boolean;
  /**
   * True when this object is a type whose metadata gets stripped (JPEG, HEIC).
   * A video or PNG is written once and never rewritten, so it is safe to copy
   * immediately.
   */
  strippable?: boolean;
}

export interface MirrorDecision {
  mirror: boolean;
  /** Why — logged, and the thing the tests actually assert on. */
  reason:
    | 'rejected'
    | 'derived-variant'
    | 'awaiting-sanitized-rewrite'
    | 'sanitized-original'
    | 'not-strippable'
    | 'unknown-prefix';
}

/**
 * Decide whether this ObjectCreated event should copy its object to R2.
 *
 * Order matters: rejection wins over everything, and the "wait for the rewrite"
 * rule must be checked before the general original case or a strippable file
 * would be copied twice — the second copy correct, the first one leaking the
 * location data we just removed.
 */
export function mirrorDecision(input: MirrorInput): MirrorDecision {
  if (input.rejected) return { mirror: false, reason: 'rejected' };

  if (DERIVED_KEY.test(input.key)) {
    return { mirror: true, reason: 'derived-variant' };
  }

  if (ORIGINAL_KEY.test(input.key)) {
    if (!input.strippable) return { mirror: true, reason: 'not-strippable' };
    return input.sanitized
      ? { mirror: true, reason: 'sanitized-original' }
      : { mirror: false, reason: 'awaiting-sanitized-rewrite' };
  }

  // Anything outside the known prefixes is not ours to copy.
  return { mirror: false, reason: 'unknown-prefix' };
}

/**
 * The R2 key for an S3 key. Identical today, and deliberately routed through
 * one function so the two stores can never drift apart by accident: the
 * gallery, the ZIP builder and the print fulfilment all resolve keys the same
 * way, and a rename would otherwise have to be repeated in each.
 */
export function r2KeyFor(s3Key: string): string {
  return s3Key;
}

/** Is the mirror configured? With anything missing, SharePix stays on S3 alone. */
export function mirrorConfigured(env: {
  R2_ACCOUNT_ENDPOINT?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}): boolean {
  return Boolean(
    env.R2_ACCOUNT_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY,
  );
}
