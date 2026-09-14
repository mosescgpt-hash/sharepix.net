import {
  backfillVerdict,
  isStrippableKey,
  summarise,
  type BackfillReason,
} from '../lib/r2Backfill';

/**
 * What a backfill may copy into R2.
 *
 * The script this guards reads production S3 and writes production R2, and the
 * one decision it makes per object is the whole of its behaviour. That decision
 * is here, as a pure function, so it can be wrong in a test rather than in a
 * bucket.
 */

const EVENT = 'events/51008c8c-3fd7-42a6-8e40-5cb4b239347f';
const preview = `${EVENT}/previews/b6292c0deb-1246-preview.jpg`;
const thumb = `${EVENT}/thumbs/b6292c0deb-1246-thumb.jpg`;
const original = `${EVENT}/photos/b6292c0deb-1246.jpg`;
const video = `${EVENT}/photos/clip-1246.mp4`;

describe('an unstripped original is never copied', () => {
  /**
   * The rule the whole script exists under.
   *
   * The sanitizer strips EXIF — including where a photo was taken — before
   * anything reaches the store reads are served from. An original with no
   * `sanitized` metadata never went through it. Copying that into R2 would
   * publish somebody's location data permanently, to make a gallery load
   * faster.
   */
  it('refuses a JPEG original with no sanitized metadata', () => {
    expect(backfillVerdict({ key: original, inR2: false })).toEqual({
      copy: false,
      reason: 'unstripped-original',
    });
    expect(backfillVerdict({ key: original, inR2: false, sanitized: false })).toEqual({
      copy: false,
      reason: 'unstripped-original',
    });
  });

  it('refuses HEIC too, which is what a modern iPhone uploads', () => {
    for (const ext of ['heic', 'HEIC', 'heif', 'JPEG', 'jpg']) {
      const key = `${EVENT}/photos/photo.${ext}`;
      expect({ ext, verdict: backfillVerdict({ key, inR2: false }) }).toEqual({
        ext,
        verdict: { copy: false, reason: 'unstripped-original' },
      });
    }
  });

  it('copies an original once it carries sanitized metadata', () => {
    expect(backfillVerdict({ key: original, inR2: false, sanitized: true })).toEqual({
      copy: true,
      reason: 'original-sanitized',
    });
  });

  it('copies a format that is never rewritten, so what is in S3 is final', () => {
    // A video or PNG has no EXIF pass, so there is no rewrite to wait for and
    // no stripped copy that could exist instead.
    expect(backfillVerdict({ key: video, inR2: false })).toEqual({
      copy: true,
      reason: 'original-not-strippable',
    });
    expect(backfillVerdict({ key: `${EVENT}/photos/shot.png`, inR2: false })).toEqual({
      copy: true,
      reason: 'original-not-strippable',
    });
  });

  it('agrees with the extension test it is built on', () => {
    expect(isStrippableKey(original)).toBe(true);
    expect(isStrippableKey(video)).toBe(false);
    // Not fooled by the word appearing mid-key.
    expect(isStrippableKey(`${EVENT}/photos/jpeg-notes.mp4`)).toBe(false);
  });
});

describe('derived variants are always safe', () => {
  // Previews and thumbs are re-encoded by the browser's canvas, which writes no
  // EXIF at all. They are also the only thing the gallery serves, so they are
  // both the safest and the most valuable half of the job.
  it('copies previews and thumbs without asking about metadata', () => {
    expect(backfillVerdict({ key: preview, inR2: false })).toEqual({
      copy: true,
      reason: 'derived-variant',
    });
    expect(backfillVerdict({ key: thumb, inR2: false })).toEqual({
      copy: true,
      reason: 'derived-variant',
    });
  });

  it('copies the exact key that was 404ing in production', () => {
    // The key from the browser's Network tab, kept verbatim: this is the object
    // whose absence sent every gallery view through a failed R2 request first.
    const real =
      'events/51008c8c-3fd7-42a6-8e40-5cb4b239347f/previews/' +
      'b6292c0deb1c938ed5002a611b2f0640-1246-preview.jpg';
    expect(backfillVerdict({ key: real, inR2: false })).toEqual({
      copy: true,
      reason: 'derived-variant',
    });
  });
});

describe('re-running costs nothing', () => {
  it('skips anything already in R2, whatever kind it is', () => {
    for (const key of [preview, thumb, original, video]) {
      expect({ key, verdict: backfillVerdict({ key, inR2: true, sanitized: true }) }).toEqual({
        key,
        verdict: { copy: false, reason: 'already-in-r2' },
      });
    }
  });

  it('checks R2 before it checks anything else', () => {
    // Ordering, stated as a property: an unstripped original already in R2 is
    // reported as present rather than refused, because the refusal is about
    // what to copy and nothing is being copied.
    expect(backfillVerdict({ key: original, inR2: true }).reason).toBe('already-in-r2');
  });
});

describe('anything outside events/ is not ours', () => {
  it('leaves other prefixes alone', () => {
    for (const key of ['site/hero.jpg', 'exports/report.csv', 'events/', 'photos/loose.jpg']) {
      expect({ key, copy: backfillVerdict({ key, inR2: false }).copy }).toEqual({
        key,
        copy: false,
      });
    }
  });
});

describe('the summary tells an operator what happened', () => {
  const zero: Record<BackfillReason, number> = {
    'derived-variant': 0,
    'original-sanitized': 0,
    'original-not-strippable': 0,
    'already-in-r2': 0,
    'unstripped-original': 0,
    'unknown-prefix': 0,
  };

  it('says nothing about refusals when there were none', () => {
    const text = summarise({ ...zero, 'derived-variant': 28, 'already-in-r2': 4 });
    expect(text).toContain('28 preview/thumb');
    expect(text).toContain('4 already in R2');
    expect(text).not.toContain('REFUSED');
  });

  it('makes a refusal impossible to miss', () => {
    // A skipped original is the one outcome that needs a human decision, so it
    // must not read like a routine count.
    const text = summarise({ ...zero, 'derived-variant': 2, 'unstripped-original': 3 });
    expect(text).toContain('REFUSED');
    expect(text).toContain('3 originals');
  });
});
