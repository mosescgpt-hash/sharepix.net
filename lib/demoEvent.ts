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
 * 2. **The imagery is generated, not photographed.** Every tile below is an SVG
 *    built here and inlined as a data URI. No stock licence to honour, no
 *    network request, nothing to keep in sync with a CDN, and — the part that
 *    matters — no real person's face used as set dressing without their say.
 *    They read as illustrations, which is honest about what the demo is.
 *
 * When there are real photos to show, from an event whose guests have agreed to
 * it, `DEMO_PHOTOS` is the one place to change.
 */

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

/** How many tiles the demo gallery shows. Enough to fill a grid, few enough to load instantly. */
export const DEMO_PHOTO_COUNT = 12;

/**
 * The demo photos, shaped exactly like real ones so the real components accept
 * them. `url` carries the generated image; there is no `fallbackUrl` because
 * there is no second copy to fall back to.
 */
export const DEMO_PHOTOS: DisplayPhoto[] = Array.from(
  { length: DEMO_PHOTO_COUNT },
  (_, i) => {
    const caption = CAPTIONS[i % CAPTIONS.length];
    return {
      id: `demo-photo-${i + 1}`,
      eventId: DEMO_EVENT_ID,
      // A plausible key shape, so anything that parses keys behaves normally.
      s3Key: `events/${DEMO_EVENT_ID}/photos/demo-${i + 1}.svg`,
      uploadedBy: UPLOADERS[i % UPLOADERS.length],
      approved: true,
      url: demoImage(i, caption),
      // Spread over an evening so the sort-by-time control has something to do.
      createdAt: new Date(Date.UTC(2026, 5, 20, 17, 0, 0) + i * 11 * 60 * 1000).toISOString(),
    };
  },
);

/**
 * The demo event. `paid` is true so nothing renders an "awaiting payment"
 * state, and the windows are far in the future so it never looks expired to
 * someone visiting the page a year from now.
 */
/**
 * Notes for the worked example, written the way real ones read: short, warm,
 * and uneven in length. Two carry an attachment, one is a video message with
 * no words, so the album shows every shape it can take.
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
    photoId: 'demo-photo-4',
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
    photoId: 'demo-photo-9',
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
