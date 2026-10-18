/**
 * What a photographer's watermark is, and where it goes on a preview.
 *
 * A text mark, a logo, or both; a corner or the centre; an opacity. Pure, and
 * identical in lib/ (the profile page's live preview), process-pro-photo
 * (stamping new uploads) and restamp-pro-photos (re-stamping existing ones
 * when the photographer changes their settings) — a test checks the copies.
 *
 * Watermarks only ever touch previews. A stored original is the
 * photographer's file and is never marked.
 */

export const WATERMARK_STYLES = ['text', 'logo', 'both'] as const;
export type WatermarkStyle = (typeof WATERMARK_STYLES)[number];

export const WATERMARK_POSITIONS = [
  'bottom-left',
  'bottom-right',
  'top-left',
  'top-right',
  'center',
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const DEFAULT_WATERMARK_POSITION: WatermarkPosition = 'bottom-left';
export const DEFAULT_WATERMARK_OPACITY = 70;
export const MIN_WATERMARK_OPACITY = 10;
export const MAX_WATERMARK_OPACITY = 100;

/** The longest logo data URL stored on a profile (well under DynamoDB's 400 KB item limit). */
export const MAX_LOGO_DATA_URL_LENGTH = 200_000;

/** The logo's width as a share of the preview's width. */
export const LOGO_WIDTH_SHARE = 0.22;

export function isWatermarkStyle(value: unknown): value is WatermarkStyle {
  return typeof value === 'string' && (WATERMARK_STYLES as readonly string[]).includes(value);
}

export function isWatermarkPosition(value: unknown): value is WatermarkPosition {
  return typeof value === 'string' && (WATERMARK_POSITIONS as readonly string[]).includes(value);
}

/** A PNG or JPEG data URL small enough to store. Anything else is not a logo. */
export function isLogoDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_LOGO_DATA_URL_LENGTH &&
    /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value)
  );
}

export function clampOpacity(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WATERMARK_OPACITY;
  return Math.min(MAX_WATERMARK_OPACITY, Math.max(MIN_WATERMARK_OPACITY, Math.round(value)));
}

export interface WatermarkSettings {
  watermarkEnabled?: boolean | null;
  watermarkText?: string | null;
  businessName?: string | null;
  watermarkStyle?: string | null;
  watermarkLogo?: string | null;
  watermarkPosition?: string | null;
  watermarkOpacity?: number | null;
}

export interface WatermarkSpec {
  text: string | null;
  /** A PNG/JPEG data URL. */
  logo: string | null;
  position: WatermarkPosition;
  /** 0–1, for compositing. */
  opacity: number;
}

/**
 * The watermark to stamp, or null for none.
 *
 * Off unless switched on. Text falls back to the business name, because an
 * enabled watermark that renders nothing looks like a bug. A style whose
 * parts are all missing (a logo style with no logo) stamps nothing rather
 * than something the photographer did not choose.
 */
export function watermarkSpec(settings: WatermarkSettings): WatermarkSpec | null {
  if (settings.watermarkEnabled !== true) return null;
  const style: WatermarkStyle = isWatermarkStyle(settings.watermarkStyle) ? settings.watermarkStyle : 'text';
  const text =
    style === 'logo'
      ? null
      : ((settings.watermarkText ?? '').trim() || (settings.businessName ?? '').trim()).slice(0, 60) || null;
  const logo = style !== 'text' && isLogoDataUrl(settings.watermarkLogo) ? settings.watermarkLogo : null;
  if (!text && !logo) return null;
  return {
    text,
    logo,
    position: isWatermarkPosition(settings.watermarkPosition)
      ? settings.watermarkPosition
      : DEFAULT_WATERMARK_POSITION,
    opacity: clampOpacity(settings.watermarkOpacity) / 100,
  };
}

/** Where a mark of this size sits on an image of that size. */
export function placement(
  imageWidth: number,
  imageHeight: number,
  markWidth: number,
  markHeight: number,
  position: WatermarkPosition,
): { x: number; y: number } {
  const pad = Math.round(Math.min(imageWidth, imageHeight) * 0.03);
  const left = pad;
  const right = Math.max(0, imageWidth - markWidth - pad);
  const top = pad;
  const bottom = Math.max(0, imageHeight - markHeight - pad);
  switch (position) {
    case 'top-left':
      return { x: left, y: top };
    case 'top-right':
      return { x: right, y: top };
    case 'bottom-right':
      return { x: right, y: bottom };
    case 'center':
      return {
        x: Math.max(0, Math.round((imageWidth - markWidth) / 2)),
        y: Math.max(0, Math.round((imageHeight - markHeight) / 2)),
      };
    default:
      return { x: left, y: bottom };
  }
}

/**
 * Where the unmarked copy of a preview lives. Kept beside every new preview so
 * the watermark can be redone when the photographer changes it — a watermark
 * cannot be taken back off a preview that already has one.
 */
export function cleanPreviewKey(previewKey: string): string | null {
  return previewKey.includes('/previews/') ? previewKey.replace('/previews/', '/clean/') : null;
}
