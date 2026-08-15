import { isHeic, stripHeicGps } from '../amplify/functions/sanitize-upload/exif';

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]; // little-endian
const u32 = (v: number) => [
  v & 0xff,
  (v >> 8) & 0xff,
  (v >> 16) & 0xff,
  (v >> 24) & 0xff,
];

/** An IFD entry: tag, type, count, then a 4-byte value-or-offset. */
function entry(tag: number, type: number, count: number, value: number[]): number[] {
  return [...u16(tag), ...u16(type), ...u32(count), ...value];
}

/** A recognisable byte pattern standing in for a stored coordinate. */
const LAT = [11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 122, 133, 144, 155, 166, 177,
  188, 199, 210, 221, 232, 243, 250, 251];

/**
 * A minimal HEIC carrying an Exif block with a GPS sub-IFD whose latitude is
 * stored out of line — the layout a phone photo actually uses.
 */
function heicWithGps(): { bytes: Uint8Array; latAt: number } {
  const ftyp = [...u32(20), ...Array.from('ftypheic', (c) => c.charCodeAt(0)), ...u32(0)];
  const preamble = [...ftyp, ...u32(8), ...Array.from('mdat', (c) => c.charCodeAt(0))];

  const exifMarker = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  const tiffStart = preamble.length + exifMarker.length;

  // TIFF header, IFD0 at +8.
  const header = [0x49, 0x49, ...u16(42), ...u32(8)];

  // IFD0: orientation + GPS pointer.
  const ifd0Offset = 8;
  const ifd0 = [
    ...u16(2),
    ...entry(0x0112, 3, 1, [...u16(6), 0, 0]), // Orientation = 6
    ...entry(0x8825, 4, 1, u32(0)), // GPS pointer — patched below
    ...u32(0),
  ];

  const gpsIfdOffset = ifd0Offset + ifd0.length;
  const gpsEntriesLength = 2 + 2 * 12 + 4;
  const latValueOffset = gpsIfdOffset + gpsEntriesLength;

  const gpsIfd = [
    ...u16(2),
    // Latitude: 3 RATIONALs = 24 bytes, so stored at an offset.
    ...entry(0x0002, 5, 3, u32(latValueOffset)),
    // Latitude ref: 2 ASCII bytes, small enough to sit inline.
    ...entry(0x0001, 2, 2, [0x4e, 0x00, 0x00, 0x00]), // "N"
    ...u32(0),
  ];

  const tiff = [...header, ...ifd0, ...gpsIfd, ...LAT];
  // Point IFD0's GPS entry at the GPS IFD now that its offset is known.
  const gpsPointerValueAt = ifd0Offset + 2 + 12 + 8;
  tiff.splice(gpsPointerValueAt, 4, ...u32(gpsIfdOffset));

  return {
    bytes: new Uint8Array([...preamble, ...exifMarker, ...tiff]),
    latAt: tiffStart + latValueOffset,
  };
}

function contains(haystack: Uint8Array, needle: number[]): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe('isHeic', () => {
  it('recognizes the HEIC/HEIF brands phones produce', () => {
    for (const brand of ['heic', 'heix', 'mif1', 'heif']) {
      const bytes = new Uint8Array([
        ...u32(20),
        ...Array.from(`ftyp${brand}`, (c) => c.charCodeAt(0)),
        ...u32(0),
      ]);
      expect(isHeic(bytes)).toBe(true);
    }
  });

  it('rejects other formats', () => {
    expect(isHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe(false); // JPEG
    // An MP4 is the same container family but not a still image.
    const mp4 = new Uint8Array([
      ...u32(20),
      ...Array.from('ftypmp42', (c) => c.charCodeAt(0)),
      ...u32(0),
    ]);
    expect(isHeic(mp4)).toBe(false);
    expect(isHeic(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe('stripHeicGps', () => {
  it('erases the stored coordinate bytes, not just the reference to them', () => {
    const { bytes } = heicWithGps();
    expect(contains(bytes, LAT)).toBe(true); // present before

    const out = stripHeicGps(bytes) as Uint8Array;
    expect(out).not.toBeNull();
    expect(contains(out, LAT)).toBe(false); // actually gone, not merely unreferenced
  });

  it('keeps the file exactly the same length, so container offsets stay valid', () => {
    const { bytes } = heicWithGps();
    const out = stripHeicGps(bytes) as Uint8Array;
    expect(out.length).toBe(bytes.length);
  });

  it('zeroes the GPS sub-IFD so readers find no tags', () => {
    const { bytes } = heicWithGps();
    const out = stripHeicGps(bytes) as Uint8Array;
    // Every byte that changed became zero — nothing was rewritten to a new value.
    for (let i = 0; i < bytes.length; i += 1) {
      if (out[i] !== bytes[i]) expect(out[i]).toBe(0);
    }
  });

  it('leaves the orientation tag intact', () => {
    const { bytes } = heicWithGps();
    const out = stripHeicGps(bytes) as Uint8Array;
    // Orientation entry: tag 0x0112, type SHORT, value 6.
    expect(contains(out, [0x12, 0x01, 0x03, 0x00])).toBe(true);
  });

  it('does not touch the bytes before the Exif block', () => {
    const { bytes } = heicWithGps();
    const out = stripHeicGps(bytes) as Uint8Array;
    expect(Array.from(out.subarray(0, 20))).toEqual(Array.from(bytes.subarray(0, 20)));
  });

  it('returns null for a HEIC with no GPS, so the object is left alone', () => {
    const noGps = new Uint8Array([
      ...u32(20),
      ...Array.from('ftypheic', (c) => c.charCodeAt(0)),
      ...u32(0),
      ...[0x45, 0x78, 0x69, 0x66, 0x00, 0x00],
      0x49, 0x49, ...u16(42), ...u32(8),
      ...u16(1),
      ...entry(0x0112, 3, 1, [...u16(1), 0, 0]),
      ...u32(0),
    ]);
    expect(stripHeicGps(noGps)).toBeNull();
  });

  it('returns null for a non-HEIC file', () => {
    expect(stripHeicGps(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toBeNull();
  });

  it('ignores an "Exif" byte run that is not followed by real TIFF', () => {
    // Image data can contain anything; a false match must not corrupt it.
    const decoy = new Uint8Array([
      ...u32(20),
      ...Array.from('ftypheic', (c) => c.charCodeAt(0)),
      ...u32(0),
      ...[0x45, 0x78, 0x69, 0x66, 0x00, 0x00],
      ...new Array(40).fill(0xab), // not a TIFF header
    ]);
    expect(stripHeicGps(decoy)).toBeNull();
  });

  it('survives a truncated GPS block without throwing', () => {
    const { bytes } = heicWithGps();
    const truncated = bytes.subarray(0, bytes.length - 12);
    expect(() => stripHeicGps(truncated)).not.toThrow();
  });
});
