/**
 * Table tents — the folded card that sits on each table telling guests to scan.
 *
 * The whole point is that a host who wants to spend zero minutes on this gets
 * something good: open the page, hit print, fold. Everything here has a
 * sensible default, and customization only ever overrides a default — there is
 * no state in which a host can end up with a blank or broken tent.
 *
 * Geometry: one portrait Letter sheet, folded once across the middle. The
 * finished tent is 8.5in wide and 5.5in tall, and needs no trimming — a home
 * printer and a single fold is the entire process. The top panel prints
 * rotated 180 degrees so that, once folded, both faces read upright to the
 * people sitting on either side of the table.
 *
 * This module is deliberately pure so the copy rules and input handling can be
 * tested without a DOM; the page owns rendering and the QR code.
 */

/** Finished tent dimensions in inches, after the single fold. */
export const TENT_WIDTH_IN = 8.5;
export const TENT_HEIGHT_IN = 5.5;

/** How long each host-supplied field may be, in characters. */
export const MAX_HEADLINE = 60;
export const MAX_MESSAGE = 160;

/** What the tent says when the host customizes nothing. */
export const DEFAULT_HEADLINE = 'Scan to add your photos';
export const DEFAULT_MESSAGE =
  "Point your phone's camera at the code and upload the pictures you took. No app, no account — everyone's photos land in one gallery.";

/**
 * Colour themes. Each is a full set, so no combination can produce unreadable
 * text, and every one keeps the QR itself dark-on-white — QR scanners need that
 * contrast, and a themed QR that looks nice but won't scan is a broken tent.
 */
export interface TentTheme {
  key: string;
  /** Shown in the theme picker. */
  label: string;
  /** Panel background. */
  background: string;
  /** Body text on that background. */
  text: string;
  /** Headline / accent text and the rule under the event name. */
  accent: string;
  /** Border around the panel and the QR card. */
  border: string;
}

export const TENT_THEMES: TentTheme[] = [
  {
    key: 'classic',
    label: 'Classic',
    background: '#FFFFFF',
    text: '#123851',
    accent: '#099361',
    border: '#123851',
  },
  {
    key: 'ink',
    label: 'Deep blue',
    background: '#123851',
    text: '#FFFFFF',
    accent: '#7AD8C0',
    border: '#7AD8C0',
  },
  {
    key: 'night',
    label: 'Midnight',
    background: '#0B2536',
    text: '#FFFFFF',
    accent: '#7AD8C0',
    border: '#7AD8C0',
  },
  {
    key: 'warm',
    label: 'Warm sand',
    background: '#F7F1E7',
    text: '#4A3520',
    accent: '#B4762B',
    border: '#B4762B',
  },
];

export const DEFAULT_THEME_KEY = 'classic';

/** Look up a theme, falling back to the default for anything unrecognized. */
export function tentTheme(key: string | null | undefined): TentTheme {
  return (
    TENT_THEMES.find((theme) => theme.key === key) ??
    (TENT_THEMES.find((theme) => theme.key === DEFAULT_THEME_KEY) as TentTheme)
  );
}

/**
 * Clean a line of host-typed text for the tent. Newlines and control characters
 * collapse to spaces so a pasted block can't blow the panel's layout apart, and
 * the result is length-capped. Returns '' for anything that was only whitespace,
 * which the caller reads as "use the default".
 */
export function sanitizeTentText(value: string | null | undefined, maxLength: number): string {
  return (value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

/** The event fields a tent draws on. */
export interface TentEvent {
  name: string;
  eventCode: string;
  date?: string | null;
  location?: string | null;
}

/** What the host has changed, if anything. Every field is optional. */
export interface TentCustomization {
  headline?: string | null;
  message?: string | null;
  themeKey?: string | null;
  /** A signed URL for a photo from the event, shown above the event name. */
  photoUrl?: string | null;
  showDate?: boolean;
  showLocation?: boolean;
  showCode?: boolean;
}

/** Everything a panel needs to render, with defaults already applied. */
export interface TentContent {
  headline: string;
  eventName: string;
  /** Formatted date, or null when absent or hidden. */
  dateLine: string | null;
  /** "Minneapolis, MN", or null when absent or hidden. */
  locationLine: string | null;
  message: string;
  uploadUrl: string;
  /** Event code, or null when hidden. */
  code: string | null;
  photoUrl: string | null;
  theme: TentTheme;
}

/**
 * Format the event date for print. Long form ("Saturday, June 6, 2026") reads
 * better on a card than a numeric date, and the midday time avoids the
 * off-by-one that parsing a bare date as UTC causes west of Greenwich.
 */
export function formatTentDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Resolve an event plus whatever the host customized into the finished panel
 * content. Anything missing falls back to the default, so this always returns
 * a complete, printable tent.
 */
export function tentContent(
  event: TentEvent,
  uploadUrl: string,
  custom: TentCustomization = {},
): TentContent {
  const headline = sanitizeTentText(custom.headline, MAX_HEADLINE) || DEFAULT_HEADLINE;
  const message = sanitizeTentText(custom.message, MAX_MESSAGE) || DEFAULT_MESSAGE;
  const date = custom.showDate === false ? null : formatTentDate(event.date);
  const location =
    custom.showLocation === false ? null : sanitizeTentText(event.location, 100) || null;

  return {
    headline,
    eventName: sanitizeTentText(event.name, 80) || 'Our event',
    dateLine: date,
    locationLine: location,
    message,
    uploadUrl,
    code: custom.showCode === false ? null : event.eventCode || null,
    photoUrl: custom.photoUrl || null,
    theme: tentTheme(custom.themeKey),
  };
}

/**
 * Font size for the event name, in points. Long names have to shrink or they
 * wrap into the QR code; this steps down rather than scaling continuously so
 * the common cases all land on a size that was actually looked at in print.
 */
export function eventNameFontSize(name: string): number {
  const length = name.length;
  if (length <= 18) return 40;
  if (length <= 28) return 33;
  if (length <= 44) return 27;
  return 22;
}
