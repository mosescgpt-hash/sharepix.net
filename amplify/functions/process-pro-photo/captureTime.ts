/**
 * When a photo was taken, read from its EXIF data.
 *
 * Booth mode (docs/booth-mode.md) matches each photo to whoever was scanned
 * most recently before the shutter fired, so it needs the capture time, not
 * the upload time. This reads exactly that and nothing else: DateTimeOriginal
 * from the Exif IFD, falling back to DateTime in IFD0. JPEG only — anything
 * else returns null and the caller falls back to the upload time.
 *
 * Kept dependency-free and identical in lib/ and
 * amplify/functions/process-pro-photo/ (a test checks), because the browser
 * reads it for the clock sync and the photo processor reads it for matching.
 */

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME = 0x0132;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TYPE_ASCII = 2;

/** "YYYY:MM:DD HH:MM:SS" exactly as the camera wrote it, or null. */
export function exifCaptureTime(bytes: Uint8Array): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    // Start of scan: the image data begins and no more metadata follows.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    const start = offset + 4;
    const end = offset + 2 + length;
    if (end > bytes.length) return null;
    if (
      marker === 0xe1 &&
      end - start > 14 &&
      bytes[start] === 0x45 && // E
      bytes[start + 1] === 0x78 && // x
      bytes[start + 2] === 0x69 && // i
      bytes[start + 3] === 0x66 && // f
      bytes[start + 4] === 0 &&
      bytes[start + 5] === 0
    ) {
      return fromTiff(bytes.subarray(start + 6, end));
    }
    offset = end;
  }
  return null;
}

function fromTiff(tiff: Uint8Array): string | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (at: number) =>
    at + 2 > tiff.length ? -1 : little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1];
  const u32 = (at: number) =>
    at + 4 > tiff.length
      ? -1
      : little
        ? (tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16)) + tiff[at + 3] * 0x1000000
        : tiff[at] * 0x1000000 + ((tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]);

  /** The tags of one IFD as tag → entry offset, bounded so bad data cannot loop. */
  const entries = (ifd: number): Map<number, number> => {
    const out = new Map<number, number>();
    const count = u16(ifd);
    if (count < 0 || count > 512) return out;
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      const tag = u16(entry);
      if (tag < 0) break;
      out.set(tag, entry);
    }
    return out;
  };

  const ascii = (entry: number): string | null => {
    if (u16(entry + 2) !== TYPE_ASCII) return null;
    const count = u32(entry + 4);
    if (count < 19 || count > 64) return null;
    const at = u32(entry + 8);
    if (at < 0 || at + 19 > tiff.length) return null;
    let text = '';
    for (let i = 0; i < 19; i += 1) text += String.fromCharCode(tiff[at + i]);
    return /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text : null;
  };

  const ifd0At = u32(4);
  if (ifd0At < 8 || ifd0At >= tiff.length) return null;
  const ifd0 = entries(ifd0At);

  const exifPointer = ifd0.get(TAG_EXIF_IFD);
  if (exifPointer !== undefined) {
    const exifAt = u32(exifPointer + 8);
    if (exifAt >= 8 && exifAt < tiff.length) {
      const original = entries(exifAt).get(TAG_DATETIME_ORIGINAL);
      const value = original !== undefined ? ascii(original) : null;
      if (value) return value;
    }
  }
  const plain = ifd0.get(TAG_DATETIME);
  return plain !== undefined ? ascii(plain) : null;
}

/**
 * The camera's wall-clock reading as milliseconds, treating it as if it were
 * UTC. Cameras record local time with no zone; the booth clock offset absorbs
 * both the zone and any drift, so this deliberately does not guess one.
 */
export function cameraClockMs(text: string): number | null {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}
