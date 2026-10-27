/**
 * Every image on the homepage, in one place.
 *
 * `pages/index.tsx` and `components/HeroProduct.tsx` read their images from
 * here and nowhere else, so this file is the full inventory of what the page
 * shows and where each picture came from.
 *
 * ## Provenance
 *
 * `screenshot` — captured from this app (the real components, running against
 * the sample event in lib/demoEvent.ts) with headless Chrome. The script is
 * `scripts/capture-homepage-images.py`. The *photographs inside* those
 * screenshots are the sample event's AI-generated pictures, which is why the
 * footer notice (`SITE_IMAGE_NOTICE`, from public/site/PROVENANCE) stays.
 *
 * `ai` — an AI-generated image on its own. The homepage allows at most one;
 * today it uses none. `__tests__/homepageImages.test.ts` enforces the limit.
 *
 * Re-capture after a UI change so the page never shows a screen that no
 * longer exists.
 */
export type HomepageImageSource = 'screenshot' | 'ai';

export interface HomepageImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  source: HomepageImageSource;
  /** What is in the picture, for whoever has to refresh it. */
  captured: string;
}

export const HOMEPAGE_IMAGES = {
  heroGuestUpload: {
    src: '/site/home/guest-upload.webp',
    alt: 'The guest upload page on a phone: the event name, an optional name field and Camera and Choose from device buttons.',
    width: 780,
    height: 1600,
    source: 'screenshot',
    captured: 'UploadForm + EventCover with the sample event, 390px wide at 2x',
  },
  heroGallery: {
    src: '/site/home/gallery-grid.webp',
    alt: 'The shared gallery: a grid of event photos, each labelled with who uploaded it and when.',
    width: 878,
    height: 1077,
    source: 'screenshot',
    captured: '/demo/gallery at 640px wide, first 3x3 photos',
  },
  slideshow: {
    src: '/site/home/slideshow.webp',
    alt: 'The live slideshow on a screen: one photo full size with the guest’s name and a code for adding more.',
    width: 1280,
    height: 675,
    source: 'screenshot',
    captured: '/demo/live at 1280x720',
  },
  hostDashboard: {
    src: '/site/home/host-dashboard.webp',
    alt: 'The host dashboard: tabs for Photos, Share, Design, Slideshow and Settings, and a grid of photos with Hide and Delete buttons.',
    width: 820,
    height: 660,
    source: 'screenshot',
    captured: 'AdminPhotoGrid with the sample event',
  },
} as const satisfies Record<string, HomepageImage>;

export type HomepageImageKey = keyof typeof HOMEPAGE_IMAGES;
