/**
 * Strip location and other metadata from JPEG originals while keeping the photo
 * the right way up.
 *
 * Phone photos routinely carry the exact GPS coordinates where they were taken,
 * and that travels with the file whenever an original is downloaded or sent to
 * a print lab. The obvious fix — delete the EXIF block — also deletes the
 * Orientation tag, and phones rely on that tag rather than rotating the pixels.
 * Drop it and a pile of portrait photos display sideways.
 *
 * So rather than editing the existing metadata in place (which means recomputing
 * every TIFF offset, and getting one wrong corrupts the file), this reads the
 * one value worth keeping and rebuilds a minimal EXIF block containing only
 * that. Everything else — GPS, timestamps, camera and lens, serial numbers,
 * embedded thumbnails, XMP, IPTC, comments — is gone by construction rather
 * than by blocklist.
 */

/** JPEG markers whose payload is metadata: APP1 (EXIF/XMP), APP13 (IPTC), COM. */
const METADATA_MARKERS = new Set([0xe1, 0xed, 0xfe]);

const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;
const APP1 = 0xe1;

/** EXIF tag for Orientation, in IFD0. */
const TAG_ORIENTATION = 0x0112;

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === SOI && bytes[2] === 0xff;
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
        0
    : ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
        0;
}

function isExifSegment(bytes: Uint8Array, payloadStart: number): boolean {
  // "Exif\0\0"
  return (
    bytes[payloadStart] === 0x45 &&
    bytes[payloadStart + 1] === 0x78 &&
    bytes[payloadStart + 2] === 0x69 &&
    bytes[payloadStart + 3] === 0x66 &&
    bytes[payloadStart + 4] === 0x00 &&
    bytes[payloadStart + 5] === 0x00
  );
}

/**
 * Read the Orientation value out of an EXIF APP1 payload, or null when absent
 * or malformed. Values outside 1–8 are not valid orientations and are ignored.
 */
function readOrientation(bytes: Uint8Array, payloadStart: number, payloadEnd: number): number | null {
  const tiff = payloadStart + 6; // skip "Exif\0\0"
  if (tiff + 8 > payloadEnd) return null;

  const byteOrder = readUint16(bytes, tiff, false);
  let littleEndian: boolean;
  if (byteOrder === 0x4949) littleEndian = true; // "II"
  else if (byteOrder === 0x4d4d) littleEndian = false; // "MM"
  else return null;

  if (readUint16(bytes, tiff + 2, littleEndian) !== 42) return null;

  const ifd0 = tiff + readUint32(bytes, tiff + 4, littleEndian);
  if (ifd0 + 2 > payloadEnd) return null;

  const entryCount = readUint16(bytes, ifd0, littleEndian);
  // A plausible IFD0; anything wilder means we're misreading the structure.
  if (entryCount > 512) return null;

  for (let i = 0; i < entryCount; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > payloadEnd) return null;
    if (readUint16(bytes, entry, littleEndian) === TAG_ORIENTATION) {
      const value = readUint16(bytes, entry + 8, littleEndian);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * Build an EXIF APP1 segment carrying nothing but Orientation. Fixed layout, so
 * there are no offsets to recompute and nothing else can survive in it.
 */
function buildOrientationOnlyExif(orientation: number): Uint8Array {
  // "Exif\0\0" + TIFF header (8) + IFD0 with one entry (2 + 12 + 4) = 32 bytes.
  const payload = new Uint8Array(32);
  payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 0); // "Exif\0\0"
  payload.set([0x49, 0x49], 6); // "II" — we always write little-endian
  payload.set([0x2a, 0x00], 8); // 42
  payload.set([0x08, 0x00, 0x00, 0x00], 10); // IFD0 at offset 8
  payload.set([0x01, 0x00], 14); // one entry
  payload.set([0x12, 0x01], 16); // tag 0x0112 (Orientation)
  payload.set([0x03, 0x00], 18); // type 3 (SHORT)
  payload.set([0x01, 0x00, 0x00, 0x00], 20); // count 1
  payload.set([orientation & 0xff, 0x00, 0x00, 0x00], 24); // value, padded
  payload.set([0x00, 0x00, 0x00, 0x00], 28); // no next IFD

  const length = payload.length + 2; // length field counts itself
  const segment = new Uint8Array(payload.length + 4);
  segment.set([0xff, APP1, (length >> 8) & 0xff, length & 0xff], 0);
  segment.set(payload, 4);
  return segment;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Remove metadata from a JPEG, keeping only the orientation.
 *
 * Returns the rewritten bytes, or null when the file is not a JPEG, carries no
 * metadata worth removing, or looks malformed — in which case the caller should
 * leave the object exactly as it is. Never re-encodes: the compressed image data
 * is copied through untouched, so there is no quality loss.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array | null {
  if (!isJpeg(bytes)) return null;

  const kept: Uint8Array[] = [bytes.subarray(0, 2)]; // SOI
  let orientation: number | null = null;
  let removedSomething = false;
  let position = 2;

  while (position + 1 < bytes.length) {
    if (bytes[position] !== 0xff) return null; // not a marker where one belongs
    const marker = bytes[position + 1];

    // Start of scan or end of image: the rest is image data, copy it verbatim.
    if (marker === SOS || marker === EOI) {
      kept.push(bytes.subarray(position));
      break;
    }

    if (position + 4 > bytes.length) return null;
    const segmentLength = readUint16(bytes, position + 2, false);
    if (segmentLength < 2) return null;
    const segmentEnd = position + 2 + segmentLength;
    if (segmentEnd > bytes.length) return null; // truncated

    if (METADATA_MARKERS.has(marker)) {
      // Salvage the orientation before discarding the EXIF block.
      if (marker === APP1 && isExifSegment(bytes, position + 4)) {
        orientation = readOrientation(bytes, position + 4, segmentEnd) ?? orientation;
      }
      removedSomething = true;
    } else {
      kept.push(bytes.subarray(position, segmentEnd));
    }
    position = segmentEnd;
  }

  if (!removedSomething) return null; // nothing to strip; leave the object alone

  // Orientation 1 is "already upright", so a segment saying so is just noise.
  if (orientation !== null && orientation !== 1) {
    kept.splice(1, 0, buildOrientationOnlyExif(orientation));
  }
  return concat(kept);
}
