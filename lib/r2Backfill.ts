/**
 * Which S3 objects a backfill may copy into R2.
 *
 * ## Why a backfill exists at all
 *
 * R2 mirroring shipped on 1 September 2026 (#92). Anything uploaded before that
 * is in S3 and was never copied, and nothing since has gone back for it. The
 * gallery asks R2 first, so every view of an older event gets a 404, waits, and
 * falls back to S3 — a doubled request per photo, and S3 egress billed for
 * reads that R2 exists to serve free.
 *
 * Nothing was broken to cause it and no alarm could have caught it: the uploads
 * simply happened before the feature. That is exactly the kind of gap that
 * never surfaces on its own.
 *
 * ## Why this is not `mirrorDecision`
 *
 * `amplify/functions/sanitize-upload/mirror.ts` decides about a *live upload*,
 * from an S3 event, where a strippable file is about to be rewritten and the
 * right move is to wait for the rewrite. A backfill looks at an object that has
 * been sitting there for weeks: there is no pending rewrite to wait for, and
 * "wait" would mean "never copy it".
 *
 * Same intent, different question, so it is a different function rather than a
 * parameter bolted onto that one.
 *
 * ## The rule that actually matters
 *
 * **An original that should have been stripped and was not must never be
 * copied.** The sanitizer removes EXIF — including where a photo was taken —
 * before anything reaches the store reads are served from. A backfill that
 * copied an unstripped original would put location data about somebody's
 * wedding into R2, permanently, in the name of a performance fix.
 *
 * Derived variants carry no such risk: previews and thumbnails are re-encoded
 * by the browser's canvas, which writes no EXIF at all. They are also the only
 * thing the gallery actually serves, so they are both the safest and the most
 * valuable half of the job.
 */

/** `events/<id>/photos/…` — a guest's uploaded original. */
const ORIGINAL_KEY = /^events\/[^/]+\/photos\//;

/** `events/<id>/previews/…` or `…/thumbs/…` — re-encoded by the browser. */
const DERIVED_KEY = /^events\/[^/]+\/(previews|thumbs)\//;

/** Extensions whose metadata the sanitizer rewrites. Mirrors `isJpeg`/`isHeic`. */
const STRIPPABLE = /\.(jpe?g|heic|heif)$/i;

export interface BackfillInput {
  /** The S3 key, which is also the R2 key — see `r2KeyFor`. */
  key: string;
  /** Whether the object is already in R2. */
  inR2: boolean;
  /** The object's `sanitized` metadata value, if it carries one. */
  sanitized?: boolean;
}

export type BackfillReason =
  | 'derived-variant'
  | 'original-sanitized'
  | 'original-not-strippable'
  | 'already-in-r2'
  | 'unstripped-original'
  | 'unknown-prefix';

export interface BackfillVerdict {
  copy: boolean;
  reason: BackfillReason;
}

/** True when this key names a file whose metadata the sanitizer would rewrite. */
export function isStrippableKey(key: string): boolean {
  return STRIPPABLE.test(key);
}

/**
 * Decide whether one S3 object should be copied to R2.
 *
 * Order matters. "Already there" wins first so a re-run is cheap and silent,
 * and the unstripped-original refusal is checked before anything that could
 * copy an original.
 */
export function backfillVerdict(input: BackfillInput): BackfillVerdict {
  if (input.inR2) return { copy: false, reason: 'already-in-r2' };

  if (DERIVED_KEY.test(input.key)) {
    return { copy: true, reason: 'derived-variant' };
  }

  if (ORIGINAL_KEY.test(input.key)) {
    if (!isStrippableKey(input.key)) {
      // A video or PNG is written once and never rewritten, so what is in S3 is
      // final and safe.
      return { copy: true, reason: 'original-not-strippable' };
    }
    if (input.sanitized) return { copy: true, reason: 'original-sanitized' };
    // Refused, loudly. This is the privacy rule, not an optimisation: the
    // caller reports these rather than skipping them quietly, because an
    // unstripped original sitting in S3 means the sanitizer never ran on it and
    // that is worth knowing on its own.
    return { copy: false, reason: 'unstripped-original' };
  }

  return { copy: false, reason: 'unknown-prefix' };
}

/** Human-readable summary of a completed run. */
export function summarise(counts: Record<BackfillReason, number>): string {
  const copied =
    counts['derived-variant'] + counts['original-sanitized'] + counts['original-not-strippable'];
  const lines = [
    `${copied} object${copied === 1 ? '' : 's'} to copy ` +
      `(${counts['derived-variant']} preview/thumb, ` +
      `${counts['original-sanitized'] + counts['original-not-strippable']} original).`,
    `${counts['already-in-r2']} already in R2.`,
  ];
  if (counts['unstripped-original'] > 0) {
    lines.push(
      `${counts['unstripped-original']} original${counts['unstripped-original'] === 1 ? '' : 's'} ` +
        'REFUSED: no `sanitized` metadata, so the EXIF may still be on them. ' +
        'They were left in S3. Re-uploading is what strips them.',
    );
  }
  if (counts['unknown-prefix'] > 0) {
    lines.push(`${counts['unknown-prefix']} outside events/ and not ours to copy.`);
  }
  return lines.join('\n');
}
