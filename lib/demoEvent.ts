/**
 * A worked example of an event, for the public demo pages.
 *
 * Two rules shaped this:
 *
 * 1. **The demo renders through the real components.** `/demo/gallery` feeds
 *    these photos to the same PhotoGrid a paying host sees. A hand-built
 *    imitation would drift from the product within a release or two and start
 *    lying to prospects; this cannot.
 *
 * 2. **The imagery comes from a folder, or from nothing.** Files dropped into
 *    `public/site/gallery/` are the gallery; the filename becomes the caption
 *    and the order. With that folder empty, every tile is an SVG built here and
 *    inlined as a data URI — no stock licence to honour, no network request,
 *    nothing to keep in sync with a CDN. Either way the page works, which is
 *    what makes the folder safe to empty.
 *
 *    The generated tiles read as illustrations, which is honest about what they
 *    are. Real photographs are not, so the page says which it is showing.
 *
 * The one thing that does not follow the folder is consent. A recognisable
 * person on a public marketing page has to have agreed to be there; the flow
 * that records that agreement is Featured Events, and `public/site/README.md`
 * says so where somebody about to add a file will read it.
 */

import { GALLERY_FILES } from './siteImages.generated';
import type { DisplayPhoto, GuestBookEntry, QREvent } from '@/lib/types';

/** Not a real event id. Nothing here touches the database. */
export const DEMO_EVENT_ID = 'demo-sharepix-example';

/**
 * Palettes for the generated tiles. Warm and celebratory rather than corporate,
 * because the thing being demonstrated is a wedding gallery.
 */
const PALETTES: [string, string][] = [
  ['#f8b4c4', '#7c3f5b'],
  ['#ffd9a0', '#a8562a'],
  ['#bfe3d0', '#2f6b52'],
  ['#c9d7f5', '#3a4d80'],
  ['#f4c9e8', '#6b3a72'],
  ['#ffe7a3', '#8a6a1f'],
  ['#c4e8f0', '#265f70'],
  ['#e8d5f2', '#553a72'],
];

/**
 * One generated tile as an SVG data URI.
 *
 * Deliberately abstract: a gradient, a horizon and a soft light source. Enough
 * to show how the gallery lays out and how the grid feels at a glance, without
 * pretending to be a photograph of anyone.
 */
export function demoImage(index: number, label: string): string {
  const [light, dark] = PALETTES[index % PALETTES.length];
  const horizon = 58 + ((index * 7) % 18);
  const sunX = 20 + ((index * 23) % 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${dark}"/>
</linearGradient>
<radialGradient id="s" cx="${sunX}%" cy="${horizon - 22}%" r="42%">
<stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
<stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="400" height="400" fill="url(#g)"/>
<rect width="400" height="400" fill="url(#s)"/>
<path d="M0 ${horizon * 4} Q 100 ${horizon * 4 - 30} 200 ${horizon * 4} T 400 ${horizon * 4} V400 H0 Z" fill="${dark}" opacity="0.35"/>
<text x="200" y="378" font-family="system-ui,sans-serif" font-size="17" fill="#ffffff" opacity="0.75" text-anchor="middle">${label}</text>
</svg>`;
  // encodeURIComponent rather than base64: smaller, and readable in devtools.
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Names on the demo photos. Ordinary guest names, not real people.
 *
 * Fewer names than photos on purpose: at a real event a handful of people take
 * most of the pictures, so several names repeat. A gallery where every photo
 * has a different uploader makes "sort by uploader" look pointless, which is
 * the opposite of what the demo is for.
 */
const UPLOADERS = ['Maya', 'Dev', 'Priya', 'Jonas', 'Aunt Bea', 'Theo', 'Nina'];

const CAPTIONS = [
  'First look',
  'The aisle',
  'Vows',
  'Confetti',
  'Toasts',
  'First dance',
  'The band',
  'Sparklers',
  'Cake',
  'Golden hour',
  'Late night',
  'Goodbyes',
];

/**
 * How many tiles to generate when `public/site/gallery/` is empty.
 *
 * Enough to fill a grid, few enough to load instantly. Once there are files in
 * the folder, the folder decides how many there are and this is not consulted.
 */
export const DEMO_FALLBACK_PHOTO_COUNT = 12;

/** Whether the sample gallery is showing photographs rather than generated tiles. */
export const DEMO_IS_PHOTOGRAPHY = GALLERY_FILES.length > 0;

/**
 * The demo photos, shaped exactly like real ones so the real components accept
 * them. There is no `fallbackUrl` because there is no second copy to fall back
 * to: a `/site/gallery/` file either resolves or the deploy is broken in a way
 * a second URL would not rescue.
 *
 * The two branches produce identically shaped rows on purpose. The gallery, the
 * slideshow and the guest book all read this array, and none of them should
 * have to know which kind of image it holds.
 */
const DEMO_TILES: Array<{ caption: string; url: string; ext: string }> =
  GALLERY_FILES.length > 0
    ? GALLERY_FILES.map((file) => ({ caption: file.caption, url: file.src, ext: 'webp' }))
    : Array.from({ length: DEMO_FALLBACK_PHOTO_COUNT }, (_, i) => {
        const caption = CAPTIONS[i % CAPTIONS.length];
        // The generated tile draws its own caption; a photograph cannot, so
        // there the caption becomes alt text instead. See DEMO_CAPTIONS.
        return { caption, url: demoImage(i, caption), ext: 'svg' };
      });

export const DEMO_PHOTOS: DisplayPhoto[] = DEMO_TILES.map(({ url, ext }, i) => ({
  id: `demo-photo-${i + 1}`,
  eventId: DEMO_EVENT_ID,
  // A plausible key shape, so anything that parses keys behaves normally.
  s3Key: `events/${DEMO_EVENT_ID}/photos/demo-${i + 1}.${ext}`,
  uploadedBy: UPLOADERS[i % UPLOADERS.length],
  approved: true,
  url,
  // Spread over an evening so the sort-by-time control has something to do.
  createdAt: new Date(Date.UTC(2026, 5, 20, 17, 0, 0) + i * 11 * 60 * 1000).toISOString(),
}));

/**
 * What each demo photo is of, by photo id.
 *
 * Kept beside DEMO_PHOTOS rather than on them: `DisplayPhoto` is the product's
 * shape, and putting a demo-only field on it would invite somebody to build a
 * real caption feature on a field only the demo ever populates.
 */
export const DEMO_CAPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  DEMO_TILES.map((tile, i) => [`demo-photo-${i + 1}`, tile.caption]),
);

/** How many tiles the demo gallery is actually showing. */
export const DEMO_PHOTO_COUNT = DEMO_PHOTOS.length;

/**
 * The demo event. `paid` is true so nothing renders an "awaiting payment"
 * state, and the windows are far in the future so it never looks expired to
 * someone visiting the page a year from now.
 */
/**
 * Notes for the worked example, written the way real ones read: short, warm,
 * and uneven in length. Two carry an attachment, one is a video message with
 * no words, so the album shows every shape it can take.
 *
 * The attached `photoId`s stay within the first eight, which is the smallest
 * gallery the folder is allowed to produce and still pass its own test. A note
 * pointing at a photo that is not there renders as a note with a hole in it,
 * and the person who emptied `public/site/gallery/` would have no way to guess
 * that was why.
 */
export const DEMO_GUEST_BOOK: GuestBookEntry[] = [
  {
    id: 'demo-note-1',
    eventId: DEMO_EVENT_ID,
    name: 'Aunt Bea',
    message:
      'I have known one of you since you were small enough to fit in a laundry basket, and I never once doubted this day would come. Be kind to each other. Eat something.',
    createdAt: new Date(Date.UTC(2026, 5, 20, 18, 12, 0)).toISOString(),
  },
  {
    id: 'demo-note-2',
    eventId: DEMO_EVENT_ID,
    name: 'Dev',
    message: 'Caught this one right as the light went. Congratulations, both of you.',
    photoId: 'demo-photo-3',
    createdAt: new Date(Date.UTC(2026, 5, 20, 19, 4, 0)).toISOString(),
  },
  {
    id: 'demo-note-3',
    eventId: DEMO_EVENT_ID,
    name: 'Priya',
    message: 'Best day. Best people. Thank you for having us.',
    createdAt: new Date(Date.UTC(2026, 5, 20, 20, 41, 0)).toISOString(),
  },
  {
    id: 'demo-note-4',
    eventId: DEMO_EVENT_ID,
    name: 'Theo',
    message:
      'Speech went better in my head.\n\nAnyway: to the two of you, and to whatever comes next.',
    photoId: 'demo-photo-6',
    createdAt: new Date(Date.UTC(2026, 5, 20, 21, 26, 0)).toISOString(),
  },
];

export const DEMO_EVENT: QREvent = {
  id: DEMO_EVENT_ID,
  name: 'Sam & Riley’s Wedding',
  eventCode: 'DEMO26',
  date: '2026-06-20',
  tier: 'event',
  location: 'Minneapolis, MN',
  photoLimit: 1000,
  photoCount: DEMO_PHOTO_COUNT,
  paid: true,
  liveSlideshowEnabled: true,
  createdBy: 'Riley',
  createdAt: '2026-05-01T12:00:00.000Z',
  accessExpiresAt: '2099-01-01T00:00:00.000Z',
  uploadWindowEndsAt: '2099-01-01T00:00:00.000Z',
};

/** How long the demo slideshow holds each photo, in milliseconds. */
export const DEMO_SLIDE_MS = 3500;

/**
 * The next slide index, wrapping. Trivial, but the wrap is the part worth
 * pinning down — an off-by-one here means the demo skips a photo forever or
 * sticks on the last one.
 */
export function nextSlide(current: number, total: number): number {
  if (total <= 0) return 0;
  return (current + 1) % total;
}
