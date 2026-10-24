/**
 * Offline booth dividers (docs/booth-mode.md, "Offline kiosk"). The
 * photographer photographs an attendee's on-screen QR code, then the
 * attendee; every photo after that code (by the camera's own clock) belongs
 * to that person until the next code. This finds the code in a photo.
 *
 * A photo is a divider only when the code is LARGE in the frame — the
 * photographer deliberately filled the shot with it. A badge or a phone in
 * the background of a portrait must never split the stream.
 */
import jsQR from 'jsqr';
import { BOOTH_OFFLINE_PREFIX } from './boothSeal';

/** Long edge the photo is scaled to before decoding: fast, and plenty for a frame-filling code. */
export const DECODE_LONG_EDGE = 1000;

/** The code's bounding box must cover at least this share of the frame… */
export const MIN_AREA_FRACTION = 0.02;
/** …and its shorter side at least this share of the frame's shorter edge. */
export const MIN_SIDE_FRACTION = 0.12;

export interface Point {
  x: number;
  y: number;
}

export interface QrHit {
  data: string;
  corners: Point[];
}

/** Whether a decoded code is big enough in the frame to count as a divider. */
export function isLargeInFrame(corners: Point[], width: number, height: number): boolean {
  if (corners.length < 4 || width <= 0 || height <= 0) return false;
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const area = (w * h) / (width * height);
  const side = Math.min(w, h) / Math.min(width, height);
  return area >= MIN_AREA_FRACTION && side >= MIN_SIDE_FRACTION;
}

/** Whether this decoded text is an offline booth code at all. */
export function isOfflineBoothPayload(data: string): boolean {
  return data.trim().startsWith(BOOTH_OFFLINE_PREFIX);
}

/**
 * The divider payload in an RGBA bitmap, or null. `requireLarge` is false
 * only when the photographer marked the photo as a divider by hand.
 */
export function findDividerCode(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  requireLarge = true,
): string | null {
  const hit = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  if (!hit?.data || !isOfflineBoothPayload(hit.data)) return null;
  const loc = hit.location;
  const corners = [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner];
  if (requireLarge && !isLargeInFrame(corners, width, height)) return null;
  return hit.data.trim();
}
