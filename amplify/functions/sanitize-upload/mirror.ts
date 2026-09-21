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
 * An upload whose location is stripped is rewritten in place, and that rewrite
 * fires a SECOND ObjectCreated event carrying `sanitized: 'true'`. Copying on
 * the first event would put the ORIGINAL — GPS and all — into R2, where it
 * would then be served to guests. Everything we strip would leak. So an object
 * this pass rewrote is deliberately skipped and mirrored only on the rewrite.
 *
 * The predicate is **"did this pass rewrite it"**, not "is it a type we might
 * rewrite". That distinction is load-bearing in both directions:
 *
 *   - A video only gets rewritten when it actually carries coordinates. Keying
 *     off the file type would leave every location-free video unmirrored, and a
 *     missing R2 object is the bug that once made a gallery take five minutes
 *     to load.
 *   - A JPEG with no metadata to remove is likewise never rewritten. Under the
 *     old type-based rule it was skipped here and no second event ever came, so
 *     it never reached R2 at all.
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
   * True when THIS pass rewrote the object, so a `sanitized: 'true'` event is
   * already on its way. False means what is in the bucket now is final, and
   * copying it is safe.
   */
  rewritten?: boolean;
}

export interface MirrorDecision {
  mirror: boolean;
  /** Why — logged, and the thing the tests actually assert on. */
  reason:
    | 'rejected'
    | 'derived-variant'
    | 'awaiting-sanitized-rewrite'
    | 'sanitized-original'
    | 'no-rewrite-pending'
    | 'unknown-prefix';
}

/**
 * Decide whether this ObjectCreated event should copy its object to R2.
 *
 * Order matters: rejection wins over everything, and the "wait for the rewrite"
 * rule must be checked before the general original case or a rewritten file
 * would be copied twice — the second copy correct, the first one leaking the
 * location data we just removed.
 */
export function mirrorDecision(input: MirrorInput): MirrorDecision {
  if (input.rejected) return { mirror: false, reason: 'rejected' };

  if (DERIVED_KEY.test(input.key)) {
    return { mirror: true, reason: 'derived-variant' };
  }

  if (ORIGINAL_KEY.test(input.key)) {
    if (!input.rewritten) return { mirror: true, reason: 'no-rewrite-pending' };
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

export interface MirrorEnv {
  R2_ACCOUNT_ENDPOINT?: string;
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

/** The same four, once this function has established they are all present. */
export type ConfiguredMirrorEnv = Required<MirrorEnv>;

/**
 * Is the mirror configured? With anything missing, SharePix stays on S3 alone.
 *
 * A type predicate rather than a boolean, so the check narrows the four values
 * for the caller. Returning a plain boolean left every caller building an
 * S3Client out of `string | undefined` and asserting its way past it, which is
 * the shape where a missing credential becomes a runtime surprise instead of a
 * compile error.
 */
export function mirrorConfigured(env: MirrorEnv): env is ConfiguredMirrorEnv {
  return Boolean(
    env.R2_ACCOUNT_ENDPOINT && env.R2_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY,
  );
}
