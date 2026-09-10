#!/usr/bin/env node
/**
 * Turn the drop-in photo folders into a module the site can import.
 *
 * ## Why a generated file and not a directory read
 *
 * A browser cannot list a directory, and `public/` is served as static files
 * with no index. So something has to read the folders at build time and write
 * down what it found. This is that something; `npm run prebuild` runs it, so a
 * photo dropped in before a build is picked up without anyone remembering to.
 *
 * The output is committed. That is deliberate: it means `npm test` can compare
 * the committed manifest against the folders and fail when they disagree, which
 * is the only way a stale manifest gets noticed before a deploy rather than
 * after one.
 *
 * ## The rules the folders enforce
 *
 * A file in `slots/` must be named after a slot in lib/imagery.ts. A misspelled
 * name is a hard error rather than a file quietly ignored — the failure mode
 * this replaces is someone dropping in `occassion-wedding.webp`, seeing the
 * placeholder still there, and having nothing to tell them why.
 *
 * `gallery/` takes any names. They are sorted, so the order in the grid is the
 * order in the folder listing, and the caption under each tile is derived from
 * the filename. That makes the folder self-documenting: to change a caption,
 * rename the file.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SLOTS_DIR = join(root, 'public', 'site', 'slots');
const GALLERY_DIR = join(root, 'public', 'site', 'gallery');
const OUTPUT = join(root, 'lib', 'siteImages.generated.ts');

/**
 * What a browser will actually display. No SVG: these folders are for
 * photographs, and an SVG dropped into them is far more likely to be a stray
 * icon than a deliberate choice.
 */
const IMAGE_EXTENSIONS = new Set(['.webp', '.avif', '.jpg', '.jpeg', '.png']);

/**
 * The slot names, read out of lib/imagery.ts rather than duplicated here.
 *
 * Parsing the source is uglier than importing it, and it is what keeps this
 * script runnable by plain node with no TypeScript loader in the way — the
 * prebuild step has to work on a clean CI checkout before anything is compiled.
 */
function knownSlots() {
  const source = readFileSync(join(root, 'lib', 'imagery.ts'), 'utf8');
  const block = source.match(/export const IMAGE_SLOTS = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error('Could not find IMAGE_SLOTS in lib/imagery.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function imagesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort();
}

/**
 * A caption from a filename: `03-first-dance.webp` becomes "First dance".
 *
 * The leading number is an ordering device, not part of the name, so it is
 * dropped. Everything else becomes words.
 */
export function captionFromFilename(filename) {
  const stem = basename(filename, extname(filename))
    .replace(/^\d+[-_]?/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  if (!stem) return 'Untitled';
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

export function buildManifest() {
  const slots = knownSlots();
  const slotFiles = {};

  for (const file of imagesIn(SLOTS_DIR)) {
    const name = basename(file, extname(file));
    if (!slots.includes(name)) {
      throw new Error(
        `public/site/slots/${file} is not a slot name.\n` +
          `Rename it to one of:\n  ${slots.join('\n  ')}`,
      );
    }
    if (slotFiles[name]) {
      // Two files claiming one slot means whichever sorts first silently wins,
      // and the other looks like it did nothing.
      throw new Error(`Two files claim the slot "${name}". Keep one of them.`);
    }
    slotFiles[name] = `/site/slots/${file}`;
  }

  const gallery = imagesIn(GALLERY_DIR).map((file) => ({
    src: `/site/gallery/${file}`,
    caption: captionFromFilename(file),
  }));

  return { slotFiles, gallery };
}

export function render({ slotFiles, gallery }) {
  const slotEntries = Object.keys(slotFiles)
    .sort()
    .map((slot) => `  '${slot}': '${slotFiles[slot]}',`)
    .join('\n');

  const galleryEntries = gallery
    .map((photo) => `  { src: '${photo.src}', caption: ${JSON.stringify(photo.caption)} },`)
    .join('\n');

  return `/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/build-site-images.mjs from the contents of
 * public/site/slots and public/site/gallery. To change what is here, add or
 * remove a photo in one of those folders and run \`npm run images\`.
 *
 * It is committed so a test can compare it against the folders; a manifest that
 * only existed at build time could go stale without anything noticing.
 */

/** Marketing photographs, keyed by the slot in lib/imagery.ts they fill. */
export const SLOT_FILES: Readonly<Record<string, string>> = {
${slotEntries}
};

export interface GalleryFile {
  src: string;
  /** Derived from the filename. Rename the file to change it. */
  caption: string;
}

/** The sample gallery, in folder order. Empty means fall back to generated tiles. */
export const GALLERY_FILES: readonly GalleryFile[] = [
${galleryEntries}
];
`;
}

function main() {
  const manifest = buildManifest();
  const output = render(manifest);
  const existing = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';

  if (existing === output) {
    console.log('lib/siteImages.generated.ts is already current.');
    return;
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, output);
  console.log(
    `Wrote lib/siteImages.generated.ts — ` +
      `${Object.keys(manifest.slotFiles).length} slot photos, ` +
      `${manifest.gallery.length} gallery photos.`,
  );
}

// Only when run directly, so the test can import buildManifest without writing.
if (process.argv[1] && process.argv[1].endsWith('build-site-images.mjs')) {
  main();
}
