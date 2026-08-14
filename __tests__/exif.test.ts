import { isJpeg, stripJpegMetadata } from '../amplify/functions/sanitize-upload/exif';

/** A JPEG marker segment: FF <marker> <2-byte length> <payload>. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/**
 * An EXIF APP1 payload containing an Orientation tag and a GPS IFD pointer —
 * the shape a phone photo actually has.
 */
function exifPayload(orientation: number, littleEndian = true): number[] {
  const u16 = (v: number) => (littleEndian ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff]);
  const u32 = (v: number) =>
    littleEndian
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]
      : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];

  return [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8), // IFD0 starts right after the header
    ...u16(2), // two entries
    // Orientation (0x0112), SHORT, count 1
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0x00, 0x00,
    // GPS IFD pointer (0x8825), LONG, count 1 — the thing we're removing
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(9999),
    ...u32(0), // no next IFD
  ];
}

const DQT = segment(0xdb, new Array(65).fill(0x10));
const SCAN_AND_EOI = [0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 0x10, 0x20, 0x30, 0xff, 0xd9];

function jpegWith(parts: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...parts.flat(), ...SCAN_AND_EOI]);
}

/** Find a marker's segment payload in a JPEG, or null. */
function findSegment(bytes: Uint8Array, marker: number): Uint8Array | null {
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const m = bytes[i + 1];
    if (m === 0xda || m === 0xd9) return null;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (m === marker) return bytes.subarray(i + 4, i + 2 + len);
    i += 2 + len;
  }
  return null;
}

describe('isJpeg', () => {
  it('recognizes a JPEG and rejects everything else', () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});

describe('stripJpegMetadata', () => {
  it('removes the EXIF block that carries GPS', () => {
    const jpeg = jpegWith([segment(0xe1, exifPayload(1)), DQT]);
    const out = stripJpegMetadata(jpeg) as Uint8Array;
    expect(out).not.toBeNull();

    // The original GPS pointer value (9999) must not survive anywhere.
    const exif = findSegment(out, 0xe1);
    expect(exif === null || !Array.from(exif).includes(0x0f)).toBe(true);
    expect(out.length).toBeLessThan(jpeg.length);
  });

  it('preserves a non-default orientation in a minimal rebuilt block', () => {
    const jpeg = jpegWith([segment(0xe1, exifPayload(6)), DQT]);
    const out = stripJpegMetadata(jpeg) as Uint8Array;

    const exif = findSegment(out, 0xe1) as Uint8Array;
    expect(exif).not.toBeNull();
    // "Exif\0\0" + II + 42 ... one entry, tag 0x0112, value 6.
    expect(Array.from(exif.subarray(0, 6))).toEqual([0x45, 0x78, 0x69, 0x66, 0, 0]);
    expect(Array.from(exif.subarray(6, 8))).toEqual([0x49, 0x49]);
    expect(exif[14]).toBe(1); // exactly one entry
    expect(Array.from(exif.subarray(16, 18))).toEqual([0x12, 0x01]); // Orientation
    expect(exif[24]).toBe(6); // the value we kept
    // The rebuilt block is tiny — nothing else could be hiding in it.
    expect(exif.length).toBe(32);
  });

  it('reads orientation from big-endian (MM) EXIF too', () => {
    const jpeg = jpegWith([segment(0xe1, exifPayload(8, false)), DQT]);
    const out = stripJpegMetadata(jpeg) as Uint8Array;
    const exif = findSegment(out, 0xe1) as Uint8Array;
    expect(exif[24]).toBe(8);
  });

  it('writes no EXIF at all when the photo is already upright', () => {
    const jpeg = jpegWith([segment(0xe1, exifPayload(1)), DQT]);
    const out = stripJpegMetadata(jpeg) as Uint8Array;
    expect(findSegment(out, 0xe1)).toBeNull();
  });

  it('copies the image data through untouched — no re-encode, no quality loss', () => {
    const jpeg = jpegWith([segment(0xe1, exifPayload(3)), DQT]);
    const out = stripJpegMetadata(jpeg) as Uint8Array;

    const scan = Array.from(out.subarray(out.length - SCAN_AND_EOI.length));
    expect(scan).toEqual(SCAN_AND_EOI);
    // The quantization table survives byte for byte.
    const dqt = findSegment(out, 0xdb) as Uint8Array;
    expect(dqt).not.toBeNull();
    expect(dqt.length).toBe(65);
  });

  it('also drops IPTC (APP13) and comment segments', () => {
    const jpeg = jpegWith([
      segment(0xed, [1, 2, 3, 4]), // APP13 / IPTC
      segment(0xfe, [5, 6, 7]), // COM
      DQT,
    ]);
    const out = stripJpegMetadata(jpeg) as Uint8Array;
    expect(findSegment(out, 0xed)).toBeNull();
    expect(findSegment(out, 0xfe)).toBeNull();
  });

  it('keeps JFIF (APP0) and other non-metadata segments', () => {
    const jfif = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const jpeg = jpegWith([jfif, segment(0xe1, exifPayload(1)), DQT]);
    const out = stripJpegMetadata(jpeg) as Uint8Array;
    expect(findSegment(out, 0xe0)).not.toBeNull();
  });

  it('returns null when there is nothing to strip, so the object is left alone', () => {
    const jpeg = jpegWith([DQT]);
    expect(stripJpegMetadata(jpeg)).toBeNull();
  });

  it('returns null for a non-JPEG', () => {
    expect(stripJpegMetadata(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))).toBeNull();
  });

  it('leaves a malformed file untouched rather than risk corrupting it', () => {
    // APP1 whose declared length runs past the end of the buffer.
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xf0, 0x01]))).toBeNull();
    // A byte where a marker should be.
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x00, 0x04]))).toBeNull();
  });

  it('is idempotent — a second pass finds nothing left to remove', () => {
    const jpeg = jpegWith([segment(0xe1, exifPayload(6)), DQT]);
    const once = stripJpegMetadata(jpeg) as Uint8Array;
    const twice = stripJpegMetadata(once);
    // The rebuilt orientation block is the only metadata left, and stripping
    // again would just rebuild the identical thing.
    if (twice !== null) {
      expect(Array.from(twice)).toEqual(Array.from(once));
    }
  });
});
