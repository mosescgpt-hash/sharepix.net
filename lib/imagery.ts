/**
 * Every photograph on the marketing site is named here, and nowhere else.
 *
 * The redesign makes photography the visual hero, and the site currently has
 * none — the audit called that out as the thing that gates the visual payoff
 * of Phases 3 to 5. Rather than block the layout work on an asset shoot, each
 * image position is a *slot*. A slot with a licensed photo behind it renders
 * the photo; a slot without one renders a deterministic placeholder in the
 * palette, at the same aspect ratio, with the same alt text.
 *
 * That means dropping real assets in later is an edit to REGISTRY and nothing
 * else. No page changes, no layout reflow, and `missingPhotography()` says at
 * any moment exactly how much of the shoot is still outstanding.
 */

export const IMAGE_SLOTS = [
  'home-hero',
  'home-gallery-preview',
  'occasion-wedding',
  'occasion-birthday',
  'occasion-graduation',
  'occasion-corporate',
  'occasion-holiday',
  'occasion-reunion',
  'how-it-works-scan',
  'how-it-works-gallery',
  'guest-book-spread',
  'live-slideshow',
] as const;

export type ImageSlot = (typeof IMAGE_SLOTS)[number];

/** A real, licensed photograph. */
export interface PhotoArtwork {
  kind: 'photo';
  src: string;
  alt: string;
  width: number;
  height: number;
  /** Attribution line, where the licence requires one. */
  credit?: string;
}

/**
 * What renders while a slot has no photograph. Deliberately not an <img> with
 * a broken src: a flat tinted block in the palette looks intentional, a broken
 * image looks like the site is unfinished.
 */
export interface PlaceholderArtwork {
  kind: 'placeholder';
  alt: string;
  /** Short human label, shown only in the styleguide, never in production. */
  label: string;
  /** 0-based index into PLACEHOLDER_TONES. Stable for a given slot. */
  tone: number;
  width: number;
  height: number;
}

export type Artwork = PhotoArtwork | PlaceholderArtwork;

interface SlotMeta {
  /** Alt text. Belongs to the slot, not the file, so it survives asset swaps. */
  alt: string;
  label: string;
  width: number;
  height: number;
}

/**
 * Alt text lives with the slot on purpose. If it lived on the asset, every
 * photo swap would silently drop the accessibility work with it.
 */
const SLOT_META: Record<ImageSlot, SlotMeta> = {
  'home-hero': {
    alt: 'Guests raising phones to photograph a couple during a reception toast',
    label: 'Home hero',
    width: 1600,
    height: 1200,
  },
  'home-gallery-preview': {
    alt: 'A grid of candid event photos taken by different guests',
    label: 'Gallery preview',
    width: 1200,
    height: 900,
  },
  'occasion-wedding': {
    alt: 'A wedding reception on a summer evening',
    label: 'Weddings',
    width: 800,
    height: 600,
  },
  'occasion-birthday': {
    alt: 'Friends around a birthday cake',
    label: 'Birthdays',
    width: 800,
    height: 600,
  },
  'occasion-graduation': {
    alt: 'A graduate with family after a commencement ceremony',
    label: 'Graduations',
    width: 800,
    height: 600,
  },
  'occasion-corporate': {
    alt: 'Colleagues talking at a company event',
    label: 'Corporate events',
    width: 800,
    height: 600,
  },
  'occasion-holiday': {
    alt: 'A family gathered around a holiday table',
    label: 'Holidays',
    width: 800,
    height: 600,
  },
  'occasion-reunion': {
    alt: 'Old friends greeting each other at a reunion',
    label: 'Reunions',
    width: 800,
    height: 600,
  },
  'how-it-works-scan': {
    alt: 'A guest pointing a phone camera at a QR code on a table card',
    label: 'Scanning the code',
    width: 900,
    height: 1200,
  },
  'how-it-works-gallery': {
    alt: 'An event gallery open on a phone',
    label: 'The gallery on a phone',
    width: 900,
    height: 1200,
  },
  'guest-book-spread': {
    alt: 'A guest recording a short video message for the couple',
    label: 'Guest book',
    width: 1200,
    height: 900,
  },
  'live-slideshow': {
    alt: 'Guest photos playing on a screen at the back of a venue',
    label: 'Live slideshow',
    width: 1600,
    height: 900,
  },
};

/**
 * Licensed photography, keyed by slot. EMPTY ON PURPOSE — every slot currently
 * falls through to a placeholder. Adding a photo is a one-line edit here.
 */
const REGISTRY: Partial<Record<ImageSlot, Omit<PhotoArtwork, 'kind' | 'alt'>>> = {};

/**
 * Placeholder tints, drawn from the palette so an empty slot still looks like
 * part of the design rather than a hole in it.
 *
 * These are COMPLETE Tailwind class strings, not token names to interpolate.
 * Tailwind resolves classes by scanning source text, so a built-up
 * `from-${tone}` compiles to nothing and the tile renders transparent. For the
 * same reason `lib/` is in the config's content globs.
 */
export const PLACEHOLDER_TONES: readonly string[] = [
  'bg-gradient-to-br from-sage to-ink',
  'bg-gradient-to-br from-sand to-charcoal',
  'bg-gradient-to-br from-sage to-night',
  'bg-gradient-to-br from-sand to-ink',
];

/**
 * Stable index into PLACEHOLDER_TONES from the slot name, so adjacent tiles
 * differ but a given slot never changes tint between renders or deploys.
 * Math.random or an array index would both break one of those two things.
 */
export function toneFor(slot: string): number {
  let sum = 0;
  for (let i = 0; i < slot.length; i += 1) {
    sum += slot.charCodeAt(i);
  }
  return sum % PLACEHOLDER_TONES.length;
}

/** The artwork to render for a slot: the photo if we have one, else a placeholder. */
export function artworkFor(slot: ImageSlot): Artwork {
  const meta = SLOT_META[slot];
  const photo = REGISTRY[slot];
  if (photo) {
    return { kind: 'photo', alt: meta.alt, ...photo };
  }
  return {
    kind: 'placeholder',
    alt: meta.alt,
    label: meta.label,
    tone: toneFor(slot),
    width: meta.width,
    height: meta.height,
  };
}

/** Slots still waiting on a real photograph. The shoot list. */
export function missingPhotography(): ImageSlot[] {
  return IMAGE_SLOTS.filter((slot) => !REGISTRY[slot]);
}

/** How much of the site is real photography, 0 to 1. */
export function photographyCoverage(): number {
  // No divide-by-zero guard: IMAGE_SLOTS is `as const`, so its length is a
  // literal type and TypeScript rejects comparing it to 0 as unreachable.
  return (IMAGE_SLOTS.length - missingPhotography().length) / IMAGE_SLOTS.length;
}
