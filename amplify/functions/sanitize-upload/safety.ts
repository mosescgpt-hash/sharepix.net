/**
 * Server-side upload content safety, shared by the S3 `sanitize-upload` trigger
 * and its tests. Pure byte logic — no AWS SDK, no I/O — so it can be unit tested
 * directly and bundled into the Lambda.
 *
 * The client already checks a file's declared MIME type and size, but those are
 * client claims. Once a file is in S3 we re-check the ACTUAL bytes: a request
 * that bypasses the UI could otherwise land an HTML/SVG/script/executable under
 * a `.jpg` name, or an object far larger than any plan allows.
 */

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // mirror lib/validation MAX_FILE_SIZE_BYTES
export const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // mirror lib/validation MAX_VIDEO_SIZE_BYTES

export type MediaKind = 'image' | 'video';

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const b = bytes[offset + i];
    if (b === undefined) return out;
    out += String.fromCharCode(b);
  }
  return out;
}

// ISO base media (MP4/MOV/HEIC/AVIF/…) brands that identify an image vs a video.
const IMAGE_FTYP_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'heif', 'mif1', 'msf1', 'avif', 'avis',
]);

/**
 * Identify a file from its leading bytes, or return null when it doesn't match
 * any image/video type this app accepts. Only the first ~32 bytes are needed.
 */
export function sniffMediaKind(bytes: Uint8Array): MediaKind | null {
  // JPEG
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image';
  // PNG
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image';
  // GIF ("GIF8")
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image';
  // WebP: "RIFF"...."WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, 4) === 'WEBP') {
    return 'image';
  }
  // WebM / Matroska (EBML)
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video';
  // ISO base media: bytes 4..7 are "ftyp"; the brand at 8..11 tells image vs video.
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4).toLowerCase();
    return IMAGE_FTYP_BRANDS.has(brand) ? 'image' : 'video';
  }
  return null;
}

/** Whether the bytes are a real image/video type the app accepts. */
export function isAllowedUploadContent(bytes: Uint8Array): boolean {
  return sniffMediaKind(bytes) !== null;
}

/** The size ceiling for a sniffed kind. */
export function maxBytesForKind(kind: MediaKind): number {
  return kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}
