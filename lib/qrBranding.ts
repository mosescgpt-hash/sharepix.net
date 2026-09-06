/**
 * How a host's QR code is styled, and what we will actually store.
 *
 * Until now the style lived in React state on the dashboard: a host picked
 * dots, dropped in their logo, printed a table tent — and the next time they
 * opened the page it was navy squares again. Worse, the table tent and the
 * brochure never used the styled code at all; they hard-coded square/#123851.
 * So the code on the printed card and the code on screen were different
 * designs. This module is what makes one saved style drive all of them.
 *
 * THE LOGO IS STORED ON THE EVENT ROW, not in S3. A QR centre image renders at
 * roughly 24% of the code, so even on a 640px print that is ~154px — a 256px
 * source is already more than enough. Downscaled and re-encoded, that is tens
 * of kilobytes, which fits an item alongside everything else and travels to
 * every consumer (dashboard, tent, brochure, moment codes) with no signed URL,
 * no new storage prefix, and no upload pipeline to go through. The cap below is
 * what keeps that true; a logo that will not fit is refused rather than
 * silently producing an item DynamoDB rejects.
 *
 * Duplicated verbatim into amplify/functions/update-event/qrBranding.ts, since
 * functions bundle separately and cannot import from lib/. The copy is the one
 * that decides; __tests__/qr-branding-function-copy.test.ts fails if they drift.
 */

export const QR_DOT_STYLES = ['square', 'rounded', 'dots', 'classy-rounded'] as const;
export type QrDotStyle = (typeof QR_DOT_STYLES)[number];

export const DEFAULT_QR_COLOR = '#123851';
export const DEFAULT_QR_DOT_STYLE: QrDotStyle = 'square';

/**
 * Base64 data URLs longer than this are refused. DynamoDB caps an item at
 * 400KB and the event row carries plenty else, so this leaves generous room
 * while still allowing a real logo.
 */
export const MAX_QR_LOGO_CHARS = 48_000;

/** What a logo may be. Anything else is refused rather than re-encoded blind. */
export const QR_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Below this contrast against white, a printed code stops scanning reliably.
 * Pale yellows and pinks land near 1.5:1 and produce a table tent that looks
 * lovely on screen and fails in a dim reception hall — an expensive way to find
 * out, since the cards are already printed.
 */
export const QR_COLOR_MIN_CONTRAST = 3;

/**
 * Above the minimum but below this is allowed and warned about. Mid-tone brand
 * colours live here: they scan in good light and struggle in bad.
 */
export const QR_COLOR_SAFE_CONTRAST = 4.5;

export function isQrDotStyle(value: unknown): value is QrDotStyle {
  return typeof value === 'string' && (QR_DOT_STYLES as readonly string[]).includes(value);
}

/** '#RRGGBB' lowercase, or null when it is not a colour we will store. */
export function normalizeQrColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  // Accept the shorthand a colour input may produce, expanded to six digits.
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return null;
}

/** WCAG relative luminance of one sRGB channel. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Contrast ratio of a colour against white, which is what a QR is printed on.
 * The background is deliberately never themed — a code that looks good and
 * will not scan is a wasted print run.
 */
export function qrColorContrast(hex: string): number {
  const colour = normalizeQrColor(hex);
  if (!colour) return 0;
  const r = channelLuminance(parseInt(colour.slice(1, 3), 16));
  const g = channelLuminance(parseInt(colour.slice(3, 5), 16));
  const b = channelLuminance(parseInt(colour.slice(5, 7), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.0 + 0.05) / (luminance + 0.05);
}

export type QrColorVerdict = 'ok' | 'marginal' | 'unscannable';

export function qrColorVerdict(hex: string): QrColorVerdict {
  const contrast = qrColorContrast(hex);
  if (contrast < QR_COLOR_MIN_CONTRAST) return 'unscannable';
  if (contrast < QR_COLOR_SAFE_CONTRAST) return 'marginal';
  return 'ok';
}

/** Whether a stored logo string is one we will accept. */
export function isStorableQrLogo(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > MAX_QR_LOGO_CHARS) return false;
  const match = /^data:([a-z]+\/[a-z+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  return (QR_LOGO_MIME_TYPES as readonly string[]).includes(match[1]);
}

export interface QrBrandingInput {
  qrDotStyle?: string | null;
  qrColor?: string | null;
  /** A data URL, '' to clear the logo, or undefined to leave it alone. */
  qrLogo?: string | null;
}

export interface QrBranding {
  qrDotStyle: QrDotStyle;
  qrColor: string;
  qrLogo: string | null;
}

export type QrBrandingResult =
  | { ok: true; branding: QrBranding }
  | { ok: false; reason: string };

/**
 * Validate a whole branding change. Anything missing falls back to the default
 * rather than erroring, so a partial update cannot leave an event half-styled.
 */
export function validateQrBranding(input: QrBrandingInput): QrBrandingResult {
  const dotStyle = isQrDotStyle(input.qrDotStyle) ? input.qrDotStyle : DEFAULT_QR_DOT_STYLE;

  const colour = input.qrColor == null || input.qrColor === ''
    ? DEFAULT_QR_COLOR
    : normalizeQrColor(input.qrColor);
  if (!colour) {
    return { ok: false, reason: 'Pick a colour in #RRGGBB form.' };
  }
  if (qrColorVerdict(colour) === 'unscannable') {
    return {
      ok: false,
      reason: 'That colour is too light to scan reliably in print. Choose a darker shade.',
    };
  }

  let logo: string | null = null;
  if (input.qrLogo) {
    if (!isStorableQrLogo(input.qrLogo)) {
      return {
        ok: false,
        reason: 'That logo could not be saved. Use a PNG, JPG, or WebP under 3 MB.',
      };
    }
    logo = input.qrLogo;
  }

  return { ok: true, branding: { qrDotStyle: dotStyle, qrColor: colour, qrLogo: logo } };
}

/**
 * The style to render an event with. Every consumer goes through this, so an
 * event with nothing saved renders exactly as it always did, and one with a
 * saved style renders the same way everywhere.
 */
export function brandingForEvent(
  event: { qrDotStyle?: string | null; qrColor?: string | null; qrLogo?: string | null } | null | undefined,
): QrBranding {
  return {
    qrDotStyle: isQrDotStyle(event?.qrDotStyle) ? event.qrDotStyle : DEFAULT_QR_DOT_STYLE,
    qrColor: normalizeQrColor(event?.qrColor) ?? DEFAULT_QR_COLOR,
    qrLogo: isStorableQrLogo(event?.qrLogo) ? event.qrLogo : null,
  };
}

/**
 * The qr-code-styling options for a saved style, at a given size.
 *
 * The background stays white at every size on purpose. A themed background is
 * the single most reliable way to print a code nobody can scan, and the tent
 * and brochure were already forcing white before this existed.
 */
export function qrStylingOptions(
  branding: QrBranding,
  { data, size, margin }: { data: string; size: number; margin: number },
) {
  const rounded = branding.qrDotStyle === 'rounded' || branding.qrDotStyle === 'classy-rounded';
  const cornerType = (
    branding.qrDotStyle === 'dots' ? 'dot' : rounded ? 'extra-rounded' : 'square'
  ) as 'dot' | 'extra-rounded' | 'square';
  return {
    width: size,
    height: size,
    type: 'canvas' as const,
    data,
    image: branding.qrLogo ?? undefined,
    margin,
    // High correction throughout: a centre logo removes modules, and a printed
    // card picks up fold creases and smudges.
    qrOptions: { errorCorrectionLevel: 'H' as const },
    dotsOptions: { type: branding.qrDotStyle, color: branding.qrColor },
    cornersSquareOptions: { type: cornerType, color: branding.qrColor },
    cornersDotOptions: { type: cornerType, color: branding.qrColor },
    backgroundOptions: { color: '#ffffff' },
    imageOptions: { hideBackgroundDots: true, imageSize: 0.24, margin: 5 },
  };
}
