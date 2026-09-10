/**
 * Three worked examples of an event, for the public demo pages.
 *
 * Three rules shaped this:
 *
 * 1. **The demo renders through the real components.** `/demo/gallery` feeds
 *    these photos to the same PhotoGrid a paying host sees. A hand-built
 *    imitation would drift from the product within a release or two and start
 *    lying to prospects; this cannot.
 *
 * 2. **The imagery comes from a folder, or from nothing.** Files dropped into
 *    `public/site/gallery/<event>/` are that event's gallery; the filename
 *    gives the order and the description. With a folder empty, every tile is an
 *    SVG built here and inlined as a data URI — no stock licence to honour, no
 *    network request, nothing to keep in sync with a CDN. Either way the page
 *    works, which is what makes a folder safe to empty.
 *
 *    The generated tiles read as illustrations, which is honest about what they
 *    are. Real photographs are not, so the page says which it is showing.
 *
 * 3. **Each sample event is one event, all the way through.** A wedding gallery
 *    with a graduation in it says SharePix does not know what it is for. The
 *    three sets share nothing — not a face, not a venue, not a guest name —
 *    because the point of having three is to show the same product working at
 *    three genuinely different occasions.
 *
 * The one thing that does not follow the folder is consent. A recognisable
 * person on a public marketing page has to have agreed to be there; the flow
 * that records that agreement is Featured Events, and `public/site/README.md`
 * says so where somebody about to add a file will read it.
 */

import { GALLERY_SETS } from './siteImages.generated';
import type { DisplayPhoto, GuestBookEntry, QREvent } from '@/lib/types';

/**
 * The sample events, in the order the switcher shows them.
 *
 * Also the folder names under `public/site/gallery/`, which
 * scripts/build-site-images.mjs reads out of this very list — so adding a
 * fourth occasion here is what makes `public/site/gallery/<name>/` a folder the
 * build will accept rather than reject.
 */
export const DEMO_GALLERY_KEYS = ['wedding', 'business', 'holiday'] as const;

export type DemoGalleryKey = (typeof DEMO_GALLERY_KEYS)[number];

export function isDemoGalleryKey(value: unknown): value is DemoGalleryKey {
  return typeof value === 'string' && (DEMO_GALLERY_KEYS as readonly string[]).includes(value);
}

/**
 * Palettes for the generated tiles. Warm and celebratory rather than corporate,
 * because what is being demonstrated is a room full of people.
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

/** How many tiles to generate for an event whose folder is empty. */
export const DEMO_FALLBACK_PHOTO_COUNT = 12;

/** What one sample event is made of, before its photos are resolved. */
interface DemoSpec {
  key: DemoGalleryKey;
  /** The switcher label. Two words at most; it sits in a row of three. */
  label: string;
  /** One line under the switcher saying what this event was. */
  blurb: string;
  event: Omit<QREvent, 'photoCount'>;
  /**
   * Names on this event's photos. Fewer names than photos on purpose: at a real
   * event a handful of people take most of the pictures, so several repeat. A
   * gallery where every photo has a different uploader makes "sort by uploader"
   * look pointless, which is the opposite of what the demo is for.
   *
   * Never shared between events — two sample galleries crediting the same
   * "Aunt Bea" would read as one family attending a trade show.
   */
  uploaders: string[];
  /** Labels for the generated tiles, used only when the folder is empty. */
  fallbackCaptions: string[];
  /** When the first photo was taken. The rest follow at eleven-minute intervals. */
  startedAt: Date;
}

/** Not real event ids. Nothing here touches the database. */
export const DEMO_EVENT_ID = 'demo-sharepix-example';
const BUSINESS_EVENT_ID = 'demo-sharepix-business';
const HOLIDAY_EVENT_ID = 'demo-sharepix-holiday';

/** Shared by all three: paid, never expiring, slideshow on. */
const NEVER_EXPIRES = {
  tier: 'event',
  photoLimit: 1000,
  // `paid` so nothing renders an "awaiting payment" state, and the windows are
  // far enough out that the sample never looks expired to somebody visiting a
  // year from now.
  paid: true,
  liveSlideshowEnabled: true,
  accessExpiresAt: '2099-01-01T00:00:00.000Z',
  uploadWindowEndsAt: '2099-01-01T00:00:00.000Z',
} as const;

const SPECS: readonly DemoSpec[] = [
  {
    key: 'wedding',
    label: 'A wedding',
    blurb: 'One evening, photographed by everyone who was there.',
    event: {
      ...NEVER_EXPIRES,
      id: DEMO_EVENT_ID,
      name: 'Sam & Riley’s Wedding',
      eventCode: 'DEMO26',
      date: '2026-06-20',
      location: 'Minneapolis, MN',
      createdBy: 'Riley',
      createdAt: '2026-05-01T12:00:00.000Z',
    },
    uploaders: ['Maya', 'Dev', 'Priya', 'Jonas', 'Aunt Bea', 'Theo', 'Nina'],
    fallbackCaptions: [
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
    ],
    startedAt: new Date(Date.UTC(2026, 5, 20, 17, 0, 0)),
  },
  {
    key: 'business',
    label: 'A company event',
    blurb: 'Two days on a stand, without asking anyone to install anything.',
    event: {
      ...NEVER_EXPIRES,
      id: BUSINESS_EVENT_ID,
      name: 'Northline at Expo West',
      eventCode: 'DEMOEX',
      date: '2026-03-12',
      location: 'Chicago, IL',
      createdBy: 'Northline',
      createdAt: '2026-02-20T12:00:00.000Z',
    },
    uploaders: ['Marcus', 'Elena', 'Tomas', 'Ana', 'Wei'],
    fallbackCaptions: [
      'Setting up',
      'First visitors',
      'The demo',
      'A closer look',
      'At the stand',
      'Getting talking',
      'Comparing notes',
      'On the screen',
      'Across the hall',
      'The quiet hour',
      'A group shot',
      'Packing down',
    ],
    // A trade-show floor, so daytime rather than an evening.
    startedAt: new Date(Date.UTC(2026, 2, 12, 9, 0, 0)),
  },
  {
    key: 'holiday',
    label: 'A holiday',
    blurb: 'Four phones in one house, and one album at the end of it.',
    event: {
      ...NEVER_EXPIRES,
      id: HOLIDAY_EVENT_ID,
      // No surname, and the uploaders are relations rather than first names.
      // A made-up family name printed over a photograph of actual-looking
      // people is a claim about who they are, and there is no reason to make
      // one — "Grandma's" says everything the sample needs to say.
      name: 'Christmas at Grandma’s',
      eventCode: 'DEMOXM',
      date: '2025-12-25',
      location: 'Asheville, NC',
      createdBy: 'Mum',
      createdAt: '2025-12-01T12:00:00.000Z',
    },
    uploaders: ['Mum', 'Dad', 'Grandpa', 'Auntie June', 'Ellie'],
    fallbackCaptions: [
      'In the kitchen',
      'The tree',
      'The cookies',
      'A quiet moment',
      'Presents',
      'Opening presents',
      'The photo screen',
      'Christmas dinner',
      'Photos on the wall',
      'Charades',
      'The big screen',
      'All of us',
    ],
    startedAt: new Date(Date.UTC(2025, 11, 25, 10, 0, 0)),
  },
];

/** One sample event, with its photos resolved from the folder or generated. */
export interface DemoGallery {
  key: DemoGalleryKey;
  label: string;
  blurb: string;
  event: QREvent;
  photos: DisplayPhoto[];
  /**
   * What each photo is of, by photo id.
   *
   * Kept beside the photos rather than on them: `DisplayPhoto` is the product's
   * shape, and putting a demo-only field on it would invite somebody to build a
   * real caption feature on a field only the demo ever populates.
   */
  captions: Readonly<Record<string, string>>;
  /** True when these are photographs, false when they are generated tiles. */
  isPhotography: boolean;
  /** How many uploaders are credited. The header counts guests with it. */
  contributors: number;
}

const ELEVEN_MINUTES = 11 * 60 * 1000;

function build(spec: DemoSpec): DemoGallery {
  const files = GALLERY_SETS[spec.key] ?? [];
  const isPhotography = files.length > 0;

  const tiles = isPhotography
    ? files.map((file) => ({ caption: file.caption, url: file.src, ext: 'webp' }))
    : Array.from({ length: DEMO_FALLBACK_PHOTO_COUNT }, (_, i) => {
        const caption = spec.fallbackCaptions[i % spec.fallbackCaptions.length];
        // The generated tile draws its own caption; a photograph cannot, so
        // there the caption becomes alt text instead. See `captions`.
        return { caption, url: demoImage(i, caption), ext: 'svg' };
      });

  const photos: DisplayPhoto[] = tiles.map(({ url, ext }, i) => ({
    id: `${spec.key}-photo-${i + 1}`,
    eventId: spec.event.id,
    // A plausible key shape, so anything that parses keys behaves normally.
    s3Key: `events/${spec.event.id}/photos/demo-${i + 1}.${ext}`,
    uploadedBy: spec.uploaders[i % spec.uploaders.length],
    approved: true,
    url,
    // Spread out so the sort-by-time control has something to do.
    createdAt: new Date(spec.startedAt.getTime() + i * ELEVEN_MINUTES).toISOString(),
  }));

  return {
    key: spec.key,
    label: spec.label,
    blurb: spec.blurb,
    event: { ...spec.event, photoCount: photos.length },
    photos,
    captions: Object.fromEntries(photos.map((photo, i) => [photo.id, tiles[i].caption])),
    isPhotography,
    contributors: new Set(photos.map((photo) => photo.uploadedBy)).size,
  };
}

export const DEMO_GALLERIES: readonly DemoGallery[] = SPECS.map(build);

/**
 * The gallery for a key, falling back to the first rather than to nothing.
 *
 * Takes `unknown` because its caller is a URL query parameter. `?event=' OR 1=1`
 * is a wedding gallery here, which is the only sane reading of it.
 */
export function demoGallery(key: unknown): DemoGallery {
  return DEMO_GALLERIES.find((gallery) => gallery.key === key) ?? DEMO_GALLERIES[0];
}

/**
 * The wedding, which every demo page other than the gallery still shows.
 *
 * `/demo/try`, `/demo/live` and `/demo/guestbook` walk through one event and
 * have a written script attached to it; three of each would be three times the
 * copy to keep true for no more persuasion. The gallery is the page where
 * showing range is the point.
 */
const WEDDING = DEMO_GALLERIES[0];

export const DEMO_EVENT: QREvent = WEDDING.event;
export const DEMO_PHOTOS: DisplayPhoto[] = WEDDING.photos;
export const DEMO_CAPTIONS: Readonly<Record<string, string>> = WEDDING.captions;
export const DEMO_IS_PHOTOGRAPHY = WEDDING.isPhotography;
export const DEMO_PHOTO_COUNT = WEDDING.photos.length;

/**
 * Notes for the worked example, written the way real ones read: short, warm,
 * and uneven in length. Two carry an attachment, one is a video message with
 * no words, so the album shows every shape it can take.
 *
 * The attached `photoId`s stay within the first eight, which is the smallest
 * gallery a folder is allowed to produce and still pass its own test. A note
 * pointing at a photo that is not there renders as a note with a hole in it,
 * and the person who emptied `public/site/gallery/wedding/` would have no way
 * to guess that was why.
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
    photoId: 'wedding-photo-3',
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
    photoId: 'wedding-photo-6',
    createdAt: new Date(Date.UTC(2026, 5, 20, 21, 26, 0)).toISOString(),
  },
];

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
