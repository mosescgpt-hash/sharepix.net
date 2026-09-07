/**
 * How a host makes the gallery look like their event.
 *
 * A wedding, a christening and a fortieth birthday do not want the same page,
 * and until now a host could brand their QR code and nothing else — the gallery
 * their guests actually look at was the same SharePix page every time.
 *
 * ## Curated, not open-ended
 *
 * This is a small set of named choices rather than a stylesheet, and that is
 * deliberate in three separate ways:
 *
 *   **Fonts are a fixed list.** Arbitrary font uploads mean licensing we cannot
 *   verify, and arbitrary Google Fonts names mean a host can request a family
 *   that fails to load and get a gallery in Times New Roman. The families here
 *   are ones the site already loads or deliberately adds.
 *
 *   **Layout is three options.** Enough that a photo-heavy wedding and a
 *   twelve-photo dinner party can both look right; not so many that a host is
 *   designing rather than choosing.
 *
 *   **The accent colour is free, but checked.** Hosts genuinely want *their*
 *   colours, so this takes any hex — and then refuses one that cannot be read
 *   against the page. A host who picks pale yellow text on white has not
 *   expressed a preference, they have made a mistake we let them make.
 *
 * ## Weight is a feature decision, not a technical detail
 *
 * Every font family costs a download on a phone, at a venue, on whatever signal
 * the building has, at the exact moment a guest is deciding whether this is
 * worth the bother. So the sets below are built from **three** families in
 * total, two of which the site already loads. Four looks, one extra request.
 *
 * ## Nothing here is trusted from the client
 *
 * Every value arrives from a browser and every value is validated server-side
 * against these lists before it is stored. A key that is not in the list is not
 * a custom theme, it is a value that reaches other people's browsers.
 */

/** A font set: what the headings use, and what the body uses. */
export interface FontSet {
  key: string;
  label: string;
  /** How it reads, for the host choosing. */
  description: string;
  /** CSS font-family stacks. Always end in a real generic family. */
  heading: string;
  body: string;
}

const POPPINS = '"Poppins", system-ui, sans-serif';
const PLAYFAIR = '"Playfair Display", Georgia, serif';
/**
 * The one family added for this feature.
 *
 * Cormorant Garamond because the look hosts ask for by name is "elegant" or
 * "wedding", and a high-contrast old-style serif is what that means visually.
 * It must be added to the Google Fonts import in styles/globals.css — a set
 * naming a family the page never loads silently falls back to Georgia.
 */
const CORMORANT = '"Cormorant Garamond", Georgia, serif';

export const FONT_SETS: FontSet[] = [
  {
    key: 'sharepix',
    label: 'SharePix',
    description: 'Clean and modern — the default.',
    heading: POPPINS,
    body: POPPINS,
  },
  {
    key: 'elegant',
    label: 'Elegant',
    description: 'Light serif throughout. Weddings, anniversaries, formal dinners.',
    heading: CORMORANT,
    body: CORMORANT,
  },
  {
    key: 'classic',
    label: 'Classic',
    description: 'Serif headings over a plain body. Reads as considered rather than fussy.',
    heading: PLAYFAIR,
    body: POPPINS,
  },
  {
    key: 'statement',
    label: 'Statement',
    description: 'Large serif headings. Good for a short, photo-led gallery.',
    heading: PLAYFAIR,
    body: PLAYFAIR,
  },
];

export const DEFAULT_FONT_SET = 'sharepix';

export interface GalleryLayoutOption {
  key: string;
  label: string;
  description: string;
}

export const GALLERY_LAYOUTS: GalleryLayoutOption[] = [
  {
    key: 'grid',
    label: 'Grid',
    description: 'Even squares. Best when there are a lot of photos.',
  },
  {
    key: 'mosaic',
    label: 'Mosaic',
    description: 'Photos keep their own shape. Feels like a scrapbook.',
  },
  {
    key: 'feed',
    label: 'Feed',
    description: 'One large photo at a time. Best for a smaller, chosen set.',
  },
];

export const DEFAULT_GALLERY_LAYOUT = 'grid';

export function isFontSetKey(value: unknown): boolean {
  return typeof value === 'string' && FONT_SETS.some((set) => set.key === value);
}

export function isGalleryLayout(value: unknown): boolean {
  return typeof value === 'string' && GALLERY_LAYOUTS.some((layout) => layout.key === value);
}

/** The font set for a key, falling back to the default rather than to nothing. */
export function fontSetFor(key: string | null | undefined): FontSet {
  return FONT_SETS.find((set) => set.key === key) ?? FONT_SETS[0];
}

export function layoutFor(key: string | null | undefined): string {
  return isGalleryLayout(key) ? (key as string) : DEFAULT_GALLERY_LAYOUT;
}

/**
 * A hex colour, or null.
 *
 * Accepts `#rgb` and `#rrggbb`, with or without the hash, and normalises to
 * lowercase six-digit with a hash. Anything else is null — including a CSS
 * colour name, a `var(--x)` and an `rgb()` call, because this value is
 * interpolated into a style attribute and the only safe answer to "is this a
 * colour?" is a shape we fully control.
 */
export function normalizeAccent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^[0-9a-f]{6}$/.test(trimmed)) return `#${trimmed}`;
  return null;
}

/** Relative luminance, per WCAG. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const part = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast ratio between two hex colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/** The gallery's background, which an accent has to be legible against. */
export const GALLERY_BACKGROUND = '#faf9f6';

/**
 * The minimum an accent must clear to be used for text.
 *
 * 4.5:1 is the WCAG AA threshold for body text. An accent below it is not
 * refused outright — a host's actual wedding colour might be a pale blush, and
 * telling them their colour is wrong helps nobody. It is stored and used for
 * fills and rules, where contrast against a background does not carry meaning,
 * and the page keeps its readable ink colour for words.
 */
export const ACCENT_TEXT_CONTRAST = 4.5;

export interface AccentUse {
  /** Always safe: borders, underlines, blocks of colour. */
  color: string;
  /** True when it may also be used for words. */
  usableForText: boolean;
  contrast: number;
}

export function accentUse(value: string | null | undefined): AccentUse | null {
  const color = normalizeAccent(value);
  if (!color) return null;
  const contrast = Math.round(contrastRatio(color, GALLERY_BACKGROUND) * 10) / 10;
  return { color, usableForText: contrast >= ACCENT_TEXT_CONTRAST, contrast };
}

export interface GalleryThemeFacts {
  galleryFontSet?: string | null;
  galleryLayout?: string | null;
  galleryAccent?: string | null;
}

export interface ResolvedGalleryTheme {
  fonts: FontSet;
  layout: string;
  accent: AccentUse | null;
  /** True when the host has changed anything at all. */
  customized: boolean;
}

/**
 * Everything the gallery needs to render, from whatever is on the row.
 *
 * Total: an event with nothing set, an event with nonsense set and an event
 * created before this existed all resolve to the same default rather than to
 * an error or a half-styled page.
 */
export function resolveGalleryTheme(
  event: GalleryThemeFacts | null | undefined,
): ResolvedGalleryTheme {
  const fonts = fontSetFor(event?.galleryFontSet);
  const layout = layoutFor(event?.galleryLayout);
  const accent = accentUse(event?.galleryAccent);
  return {
    fonts,
    layout,
    accent,
    customized:
      fonts.key !== DEFAULT_FONT_SET || layout !== DEFAULT_GALLERY_LAYOUT || accent !== null,
  };
}

/**
 * The CSS custom properties a themed page sets.
 *
 * Returned as an object for React's `style` prop rather than as a string of
 * CSS, so there is no path by which a stored value becomes markup. Every value
 * in it has been through the validators above.
 */
export function themeStyle(theme: ResolvedGalleryTheme): Record<string, string> {
  const style: Record<string, string> = {
    '--spx-event-heading': theme.fonts.heading,
    '--spx-event-body': theme.fonts.body,
  };
  if (theme.accent) {
    style['--spx-event-accent'] = theme.accent.color;
    // Words only get the accent when it can actually be read. Otherwise the
    // page keeps its own ink and the accent lives in rules and fills.
    style['--spx-event-accent-text'] = theme.accent.usableForText
      ? theme.accent.color
      : 'inherit';
  }
  return style;
}
