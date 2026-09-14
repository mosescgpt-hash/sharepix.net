/**
 * Which S3 objects a backfill may copy into R2.
 *
 * Hand-copied from `lib/r2Backfill.ts` because Amplify functions take no
 * cross-bundle imports. `__tests__/r2-backfill-function-copy.test.ts` compares
 * the two byte for byte below this comment.
 *
 * This copy is the one that decides: the script and the admin button both run
 * the same rule, and the rule refuses to copy an original whose EXIF may never
 * have been stripped. See the original for why that matters.
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
