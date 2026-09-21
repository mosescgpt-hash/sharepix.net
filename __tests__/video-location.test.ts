import {
  findMoov,
  isMp4,
  locationRangesInMoov,
  patchChunk,
  type ZeroRange,
} from '../amplify/functions/sanitize-upload/video';

/**
 * Location stripping for video, tested against MP4 structures built by hand.
 *
 * ## What these tests can and cannot prove
 *
 * They prove the parser finds the right bytes and the patcher zeroes only
 * those. They **cannot** prove a real iPhone clip survives the round trip,
 * because nothing in this environment can produce one. That check belongs to a
 * person with a phone, and `docs/moderation.md` says so rather than letting
 * this file imply coverage it does not have.
 *
 * What the tests do cover is the failure that would actually hurt: a range
 * landing anywhere it should not. A wrong offset here does not lose a
 * coordinate, it corrupts somebody's video of a first dance.
 */

const HEADER = 8;

/** A box: size, four-character type, payload. */
function box(type: string, payload: Buffer | Buffer[]): Buffer {
  const body = Array.isArray(payload) ? Buffer.concat(payload) : payload;
  const head = Buffer.alloc(HEADER);
  head.writeUInt32BE(HEADER + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

/** `©xyz` — the © is 0xA9, which is not expressible as a JS string literal here. */
const XYZ = Buffer.from([0xa9, 0x78, 0x79, 0x7a]).toString('latin1');

/** An ISO 6709 payload the way a phone writes it: length, language, text. */
function iso6709(text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt16BE(body.length, 0);
  head.writeUInt16BE(0x15c7, 2); // language code
  return Buffer.concat([head, body]);
}

const COORDS = '+44.9778-093.2650+015.000/';

describe('recognising the container', () => {
  it('accepts the shapes a phone actually produces', () => {
    const ftyp = Buffer.concat([box('ftyp', Buffer.alloc(8)), Buffer.alloc(4)]);
    expect(isMp4(ftyp)).toBe(true);
  });

  it('rejects something too short to tell', () => {
    expect(isMp4(Buffer.alloc(4))).toBe(false);
  });

  it('rejects a file that is not a container at all', () => {
    expect(isMp4(Buffer.from('GIF89a-and-then-some-bytes'))).toBe(false);
  });
});

describe('finding moov without downloading the file', () => {
  /** A reader over a buffer, counting how much it was asked for. */
  function readerFor(file: Buffer) {
    let bytesRead = 0;
    const read = async (start: number, end: number) => {
      bytesRead += end - start;
      return file.subarray(start, end);
    };
    return { read, bytes: () => bytesRead };
  }

  it('finds moov at the front of a fast-start file', async () => {
    const file = Buffer.concat([box('ftyp', Buffer.alloc(16)), box('moov', Buffer.alloc(40))]);
    const reader = readerFor(file);
    const found = await findMoov(file.length, reader.read);
    expect(found).toEqual({ start: 24, size: 48 });
  });

  it('finds moov after a huge mdat without reading the mdat', async () => {
    // The case that matters: straight off a phone, moov is last. Reading the
    // file to find it would pull 250 MB through a 512 MB Lambda.
    const mdat = box('mdat', Buffer.alloc(40_000_000));
    const file = Buffer.concat([box('ftyp', Buffer.alloc(16)), mdat, box('moov', Buffer.alloc(40))]);
    const reader = readerFor(file);

    const found = await findMoov(file.length, reader.read);

    expect(found?.start).toBe(24 + mdat.length);
    expect(reader.bytes()).toBeLessThan(200);
  });

  it('gives up rather than looping on a zero-length box', async () => {
    const broken = Buffer.alloc(16);
    broken.writeUInt32BE(4, 0); // smaller than a header
    broken.write('junk', 4, 'latin1');
    const found = await findMoov(broken.length, async (s, e) => broken.subarray(s, e));
    expect(found).toBeNull();
  });

  it('returns null when there is no moov', async () => {
    const file = Buffer.concat([box('ftyp', Buffer.alloc(8)), box('mdat', Buffer.alloc(32))]);
    expect(await findMoov(file.length, async (s, e) => file.subarray(s, e))).toBeNull();
  });
});

describe('locating the coordinates', () => {
  const at = (file: Buffer, range: ZeroRange) =>
    file.subarray(range.start, range.end).toString('utf8');

  it('finds udta/(c)xyz, the common case', () => {
    const moov = box('moov', box('udta', box(XYZ, iso6709(COORDS))));
    const ranges = locationRangesInMoov(moov, 0);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].label).toContain('xyz');
    expect(at(moov, ranges[0])).toContain(COORDS);
  });

  it('finds the older Android loci box', () => {
    const moov = box('moov', box('udta', box('loci', Buffer.from('\u0000\u0000...loc', 'utf8'))));
    const ranges = locationRangesInMoov(moov, 0);
    expect(ranges.map((r) => r.label)).toEqual(['udta/loci']);
  });

  it('finds Apple keyed location through the keys box', () => {
    // keys: FullBox (4) + count (4), then one entry per name.
    const key = (name: string) => box('mdta', Buffer.from(name, 'utf8'));
    const keysPayload = Buffer.concat([
      Buffer.alloc(8),
      key('com.apple.quicktime.make'),
      key('com.apple.quicktime.location.ISO6709'),
    ]);
    const item = (index: number, value: string) => {
      const head = Buffer.alloc(4);
      head.writeUInt32BE(index, 0);
      return Buffer.concat([
        (() => {
          const inner = box('data', Buffer.concat([Buffer.alloc(8), Buffer.from(value, 'utf8')]));
          const h = Buffer.alloc(HEADER);
          h.writeUInt32BE(HEADER + inner.length, 0);
          head.copy(h, 4);
          return Buffer.concat([h, inner]);
        })(),
      ]);
    };
    const moov = box('moov', [
      box('meta', [
        Buffer.alloc(4), // version/flags — the ISO shape
        box('hdlr', Buffer.alloc(8)),
        box('keys', keysPayload),
        box('ilst', [item(1, 'Apple'), item(2, COORDS)]),
      ]),
    ]);

    const ranges = locationRangesInMoov(moov, 0);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].label).toContain('apple-location');
    expect(at(moov, ranges[0])).toContain(COORDS);
  });

  it('handles a QuickTime meta box, which has no version field', () => {
    // MOV and MP4 both arrive as .mov/.mp4 and differ here. Guessing wrong
    // loses the metadata silently, which reads as "no location found".
    const moov = box('moov', [
      box('meta', [box('hdlr', Buffer.alloc(8)), box('ilst', box(XYZ, box('data', iso6709(COORDS))))]),
    ]);
    const ranges = locationRangesInMoov(moov, 0);
    expect(ranges).toHaveLength(1);
    expect(at(moov, ranges[0])).toContain(COORDS);
  });

  it('finds every copy when a phone writes more than one', () => {
    // iPhones write udta/(c)xyz and the keyed form. Missing either leaves the
    // coordinates in the file while reporting success.
    const moov = box('moov', [
      box('udta', box(XYZ, iso6709(COORDS))),
      box('meta', [Buffer.alloc(4), box('ilst', box(XYZ, box('data', iso6709(COORDS))))]),
    ]);
    expect(locationRangesInMoov(moov, 0)).toHaveLength(2);
  });

  it('reports nothing for a video with no location', () => {
    const moov = box('moov', [box('udta', box('name', Buffer.from('Wedding', 'utf8')))]);
    expect(locationRangesInMoov(moov, 0)).toEqual([]);
  });

  it('offsets every range by where moov sits in the file', () => {
    const moov = box('moov', box('udta', box(XYZ, iso6709(COORDS))));
    const offset = 40_000_000;
    const [range] = locationRangesInMoov(moov, offset);
    expect(range.start).toBeGreaterThan(offset);
    expect(range.start - offset).toBe(locationRangesInMoov(moov, 0)[0].start);
  });

  it('never returns a range outside the moov box it was given', () => {
    // The guarantee that keeps this away from mdat. A range past the end of
    // moov would, in a real file, land in the media data.
    const moov = box('moov', [
      box('udta', [box(XYZ, iso6709(COORDS)), box('loci', Buffer.alloc(12))]),
    ]);
    for (const range of locationRangesInMoov(moov, 0)) {
      expect(range.start).toBeGreaterThanOrEqual(0);
      expect(range.end).toBeLessThanOrEqual(moov.length);
    }
  });

  it('refuses a truncated box rather than reading past it', () => {
    const moov = box('moov', box('udta', box(XYZ, iso6709(COORDS))));
    const truncated = moov.subarray(0, moov.length - 6);
    expect(() => locationRangesInMoov(truncated, 0)).not.toThrow();
  });

  it('ignores a buffer that is not a moov box', () => {
    expect(locationRangesInMoov(box('mdat', Buffer.alloc(32)), 0)).toEqual([]);
  });
});

describe('zeroing as the bytes go past', () => {
  it('blanks a range inside one chunk', () => {
    const chunk = Buffer.from('keep-SECRET-keep');
    patchChunk(chunk, 0, [{ start: 5, end: 11, label: 'x' }]);
    expect(chunk.toString()).toBe(`keep-${'\u0000'.repeat(6)}-keep`);
  });

  it('blanks a range that straddles two chunks', () => {
    // The case a naive implementation gets wrong, and it fails by leaving half
    // the coordinates in the file.
    const first = Buffer.from('aaaaSEC');
    const second = Buffer.from('RETbbbb');
    const ranges = [{ start: 4, end: 10, label: 'x' }];

    patchChunk(first, 0, ranges);
    patchChunk(second, first.length, ranges);

    expect(first.toString()).toBe(`aaaa${'\u0000'.repeat(3)}`);
    expect(second.toString()).toBe(`${'\u0000'.repeat(3)}bbbb`);
  });

  it('leaves a chunk alone when no range touches it', () => {
    const chunk = Buffer.from('untouched');
    patchChunk(chunk, 1_000, [{ start: 5, end: 11, label: 'x' }]);
    expect(chunk.toString()).toBe('untouched');
  });

  it('does not change the length of anything', () => {
    // The whole reason this zeroes instead of deleting: stco/co64 hold absolute
    // file offsets, and a shorter file makes every one of them wrong.
    const chunk = Buffer.from('aaaaaaaaaaaa');
    const before = chunk.length;
    patchChunk(chunk, 0, [{ start: 2, end: 9, label: 'x' }]);
    expect(chunk.length).toBe(before);
  });
});
