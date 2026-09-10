import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { IMAGE_SLOTS } from '../lib/imagery';
import { DEMO_GALLERY_KEYS } from '../lib/demoEvent';
import { GALLERY_SETS, SLOT_FILES } from '../lib/siteImages.generated';

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

describe('no page claims to know what it is showing', () => {
  // Three pages carried "illustrations, not photographs" as a flat sentence.
  // Two were switched to the data when the photographs landed and the third
  // was missed, so /demo/try told visitors its photographs were illustrations
  // until somebody noticed. The rule is the fix: a page that says the word at
  // all has to be choosing, not asserting.
  const PAGES = ['pages/demo/gallery.tsx', 'pages/demo/live.tsx', 'pages/demo/try.tsx'];

  it.each(PAGES)('%s decides from the data rather than asserting', (page) => {
    const source = readFileSync(join(root, page), 'utf8');
    if (!/illustrations|photographs/.test(source)) return;
    // Either flag counts: the gallery reads the active event's own
    // `isPhotography`, the single-event pages read the module-level
    // DEMO_IS_PHOTOGRAPHY. What is not allowed is neither.
    expect(source).toMatch(/isPhotography|IS_PHOTOGRAPHY/);
  });
});
