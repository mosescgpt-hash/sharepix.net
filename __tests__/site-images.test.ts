import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { IMAGE_SLOTS } from '../lib/imagery';
import {
  DEMO_GALLERY_KEYS,
  IMAGES_ARE_AI,
  SITE_IMAGE_NOTICE,
  sampleImageNotice,
  sampleImageNoticeShort,
} from '../lib/demoEvent';
import { GALLERY_SETS, SLOT_FILES } from '../lib/siteImages.generated';
import { codeOnly } from './sourceGuards';

/**
 * The committed manifest against the folders it claims to describe.
 *
 * `lib/siteImages.generated.ts` is written by scripts/build-site-images.mjs and
 * checked in, which buys exactly one thing: this test. A manifest that only
 * existed at build time could not go stale, but neither could anything tell you
 * that a photo you added was never going to appear — you would find out from
 * the deployed site.
 *
 * The scan here is written out again rather than imported from the script, on
 * purpose. A freshness check that shares its directory-reading code with the
 * thing it is checking agrees with it by construction.
 */

const root = join(__dirname, '..');
const SLOTS_DIR = join(root, 'public', 'site', 'slots');
const GALLERY_DIR = join(root, 'public', 'site', 'gallery');
const IMAGE_EXTENSIONS = ['.webp', '.avif', '.jpg', '.jpeg', '.png'];

function imagesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => IMAGE_EXTENSIONS.includes(extname(name).toLowerCase()))
    .sort();
}

describe('the manifest matches the folders', () => {
  it('lists every file in public/site/slots, and nothing else', () => {
    const onDisk = imagesIn(SLOTS_DIR).map((file) => `/site/slots/${file}`).sort();
    expect(Object.values(SLOT_FILES).sort()).toEqual(onDisk);
  });

  it('lists every file in each gallery folder, in folder order', () => {
    for (const key of DEMO_GALLERY_KEYS) {
      const onDisk = imagesIn(join(GALLERY_DIR, key)).map((file) => `/site/gallery/${key}/${file}`);
      expect((GALLERY_SETS[key] ?? []).map((photo) => photo.src)).toEqual(onDisk);
    }
  });

  it('names no gallery folder that is not a sample event', () => {
    for (const key of Object.keys(GALLERY_SETS)) {
      expect(DEMO_GALLERY_KEYS).toContain(key);
    }
  });

  it('leaves no loose image directly in public/site/gallery', () => {
    // Ambiguous by construction: it belongs to one of the three events and
    // only whoever put it there knows which.
    expect(imagesIn(GALLERY_DIR)).toEqual([]);
  });

  it('names each slot file after the slot it fills', () => {
    for (const [slot, src] of Object.entries(SLOT_FILES)) {
      expect(IMAGE_SLOTS).toContain(slot);
      expect(src).toBe(`/site/slots/${slot}${extname(src)}`);
    }
  });
});

describe('what the folders are allowed to contain', () => {
  it('gives every gallery photo a description derived from its name', () => {
    for (const photos of Object.values(GALLERY_SETS)) {
      for (const photo of photos) {
        expect(photo.caption.length).toBeGreaterThan(2);
        // The leading sort number is an ordering device, not part of the name.
        expect(photo.caption).not.toMatch(/^\d/);
        expect(photo.caption[0]).toBe(photo.caption[0].toUpperCase());
      }
    }
  });

  it('keeps each gallery big enough to look like a gallery, or empty', () => {
    // Three photographs in a grid built for a wedding's worth of them looks
    // like a page that failed. Empty is fine — that falls back to generated
    // tiles — but a token handful is not.
    for (const photos of Object.values(GALLERY_SETS)) {
      expect(photos.length === 0 || photos.length >= 8).toBe(true);
    }
  });

  it('has no two files claiming one slot', () => {
    const slots = imagesIn(SLOTS_DIR).map((file) => file.slice(0, -extname(file).length));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('documents itself where somebody adding a photo will look', () => {
    expect(existsSync(join(root, 'public', 'site', 'README.md'))).toBe(true);
  });
});

describe('no page writes the sample notice itself', () => {
  // Three pages each carried their own copy of "illustrations, not
  // photographs" behind its own ternary. Two were switched to the data when
  // the photographs landed and the third was missed, so /demo/try told
  // visitors its twelve photographs were illustrations until somebody noticed.
  //
  // The first fix was a rule that a page saying the word had to be choosing
  // rather than asserting. That was the right rule and the wrong place: three
  // pages were still each deciding, so there were still three chances to get
  // it wrong. The sentence now exists once, in lib/demoEvent.ts, and the rule
  // is simply that no page may build its own.
  const PAGES = ['pages/demo/gallery.tsx', 'pages/demo/live.tsx', 'pages/demo/try.tsx'];

  it.each(PAGES)('%s renders the shared sentence', (page) => {
    const source = readFileSync(join(root, page), 'utf8');
    expect(source).toMatch(/sampleImageNotice(Short)?\(/);
  });

  it.each(PAGES)('%s does not write one of its own', (page) => {
    // Comments are stripped: two of these pages explain in prose what went
    // wrong last time, and that explanation necessarily quotes the sentence.
    const code = codeOnly(readFileSync(join(root, page), 'utf8'));
    expect(code).not.toContain('illustrations, not photographs');
    expect(code).not.toContain('not a real event');
  });
});

describe('where the images came from', () => {
  it('is recorded in a file beside them, not asserted in the code', () => {
    // public/site/ is a drop-in folder. A claim hardcoded in a component stops
    // being true the moment somebody replaces the photographs, and nothing
    // fails when it does. Whoever swaps the files is standing in this folder.
    const file = join(root, 'public', 'site', 'PROVENANCE');
    expect(existsSync(file)).toBe(true);
    const value = readFileSync(file, 'utf8').trim();
    expect(['ai-generated', 'photographed', 'mixed']).toContain(value);
  });

  it('reaches the generated manifest', () => {
    const value = readFileSync(join(root, 'public', 'site', 'PROVENANCE'), 'utf8').trim();
    const generated = readFileSync(join(root, 'lib', 'siteImages.generated.ts'), 'utf8');
    expect(generated).toContain(`IMAGE_PROVENANCE: ImageProvenance = '${value}'`);
  });

  it('says so in the footer while the images are generated', () => {
    // The demo pages are not the only place they appear: the homepage hero,
    // the occasion squares and the link-preview card are the same set.
    const notice = SITE_IMAGE_NOTICE;
    if (IMAGES_ARE_AI) {
      expect(notice).toMatch(/AI-generated/);
      expect(codeOnly(readFileSync(join(root, 'components', 'Layout.tsx'), 'utf8')))
        .toContain('SITE_IMAGE_NOTICE');
    } else {
      // Nothing to disclose, and the footer renders nothing.
      expect(notice).toBeNull();
    }
  });

  it('names it in the notice the demo pages show', () => {
    const notice = sampleImageNotice(true);
    expect(notice).toContain(IMAGES_ARE_AI ? 'AI-generated' : 'our own images');
  });

  it('does not call an SVG placeholder AI-generated', () => {
    // With the folders empty every tile is an SVG built in lib/demoEvent.ts.
    // "AI-generated" would be the wrong word for a rectangle with a caption.
    expect(sampleImageNotice(false)).toContain('illustrations');
    expect(sampleImageNotice(false)).not.toContain('AI-generated');
    expect(sampleImageNoticeShort(false)).not.toContain('AI-generated');
  });

  it('tells whoever drops images in to update it', () => {
    expect(readFileSync(join(root, 'public', 'site', 'README.md'), 'utf8')).toContain(
      'PROVENANCE',
    );
  });
});
