import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { IMAGE_SLOTS } from '../lib/imagery';
import { GALLERY_FILES, SLOT_FILES } from '../lib/siteImages.generated';

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

  it('lists every file in public/site/gallery, in folder order', () => {
    const onDisk = imagesIn(GALLERY_DIR).map((file) => `/site/gallery/${file}`);
    expect(GALLERY_FILES.map((photo) => photo.src)).toEqual(onDisk);
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
    for (const photo of GALLERY_FILES) {
      expect(photo.caption.length).toBeGreaterThan(2);
      // The leading sort number is an ordering device, not part of the name.
      expect(photo.caption).not.toMatch(/^\d/);
      expect(photo.caption[0]).toBe(photo.caption[0].toUpperCase());
    }
  });

  it('keeps the gallery big enough to look like a gallery, or empty', () => {
    // Three photographs in a grid built for a wedding's worth of them looks
    // like a page that failed. Empty is fine — that falls back to generated
    // tiles — but a token handful is not.
    expect(GALLERY_FILES.length === 0 || GALLERY_FILES.length >= 8).toBe(true);
  });

  it('has no two files claiming one slot', () => {
    const slots = imagesIn(SLOTS_DIR).map((file) => file.slice(0, -extname(file).length));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('documents itself where somebody adding a photo will look', () => {
    expect(existsSync(join(root, 'public', 'site', 'README.md'))).toBe(true);
  });
});
