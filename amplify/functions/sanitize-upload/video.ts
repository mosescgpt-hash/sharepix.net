/**
 * Find the location metadata in an MP4/QuickTime file, so it can be erased.
 *
 * Phones write the coordinates a video was shot at into the container, exactly
 * as they do for photos. `exif.ts` handles the photo side; this is the same
 * promise for video, which the product claimed to keep and did not.
 *
 * ## Why this only ever zeroes bytes
 *
 * The obvious fix — delete the boxes — changes every byte offset after them.
 * In an MP4 the sample tables (`stco`/`co64`) hold absolute file offsets of the
 * media chunks, and a `moov` that sits *before* `mdat` means removing forty
 * bytes of metadata invalidates every one of them. Get that wrong and the file
 * is a silent brick: it still has a thumbnail, it still has a duration, and it
 * plays nothing.
 *
 * So nothing is ever resized. Each location payload is overwritten with zeroes
 * **in place**, which leaves every box the same length, every parent size
 * correct, and every chunk offset still pointing where it did. A zeroed `©xyz`
 * reads as a zero-length string, which is what a video with no location looks
 * like anyway.
 *
 * ## Why the tree is walked rather than scanned
 *
 * `exif.ts` scans HEIC bytes for a marker and validates what it finds. That is
 * safe there because the files are small and the validation is strong. It would
 * not be safe here: a 250 MB `mdat` is a quarter of a gigabyte of compressed
 * video, and four bytes that happen to spell a box type will occur in it. This
 * walks down from the top of the file instead — `moov`, then `udta` and `meta`
 * inside it — so nothing in the media data is ever a candidate. **No range this
 * returns can fall inside `mdat`**, by construction.
 *
 * ## What is looked for
 *
 * | Where | Written by |
 * | --- | --- |
 * | `moov/udta/©xyz` | iPhone and most Android — ISO 6709, the common case |
 * | `moov/udta/loci` | older Android, 3GPP |
 * | `moov/meta/ilst/©xyz` | iTunes-style metadata |
 * | `moov/meta/keys` + `ilst` | Apple's newer keyed metadata, by index |
 */

/** A half-open byte range, absolute in the file, to overwrite with zeroes. */
export interface ZeroRange {
  start: number;
  end: number;
  /** Which box this came from. For logging, and for the tests to be readable. */
  label: string;
}

const HEADER = 8;
/** `©xyz`, the ISO 6709 location box. The © is 0xA9. */
const XYZ = Buffer.from([0xa9, 0x78, 0x79, 0x7a]);

/**
 * Apple's keyed metadata names that carry where the camera was.
 *
 * The accuracy field is included because it is a companion to the coordinates
 * and describes the same event; leaving it behind would be odd rather than
 * dangerous.
 */
const LOCATION_KEYS = [
  'com.apple.quicktime.location.ISO6709',
  'com.apple.quicktime.location.accuracy.horizontal',
];

interface Box {
  type: string;
  /** Offset of the box header, relative to the buffer it was read from. */
  start: number;
  /** Offset of the first payload byte. */
  payloadStart: number;
  /** Offset one past the last byte of the box. */
  end: number;
}

/**
 * Read one box header.
 *
 * Returns null when the header is truncated or the size is nonsense, which is
 * the signal to stop walking rather than to guess.
 */
function readBox(buf: Buffer, at: number, limit: number): Box | null {
  if (at + HEADER > limit) return null;
  const size32 = buf.readUInt32BE(at);
  const type = buf.toString('latin1', at + 4, at + 8);
  let size = size32;
  let payloadStart = at + HEADER;

  if (size32 === 1) {
    // 64-bit size, in the eight bytes after the type.
    if (at + 16 > limit) return null;
    const large = buf.readBigUInt64BE(at + 8);
    // Beyond this a Number loses precision, and no honest box is this big.
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    payloadStart = at + 16;
  } else if (size32 === 0) {
    // Extends to the end of the enclosing container.
    size = limit - at;
  }

  if (size < payloadStart - at) return null;
  const end = at + size;
  if (end > limit) return null;
  return { type, start: at, payloadStart, end };
}

/** Every direct child of a container. */
function children(buf: Buffer, from: number, to: number): Box[] {
  const found: Box[] = [];
  let at = from;
  while (at < to) {
    const box = readBox(buf, at, to);
    if (!box || box.end <= at) break;
    found.push(box);
    at = box.end;
  }
  return found;
}

/**
 * Where a `meta` box's children begin.
 *
 * `meta` is a FullBox in ISO MP4 — four bytes of version and flags before the
 * children — and a plain container in QuickTime MOV. The same file extension
 * carries both, so the shape has to be detected rather than assumed: if the
 * bytes right after the header read as a sensible box, there is no version
 * field; otherwise skip four and try again.
 *
 * Guessing wrong in either direction loses the metadata entirely, which here
 * means silently failing to strip a location while reporting success.
 */
function metaChildrenStart(buf: Buffer, box: Box): number {
  const direct = readBox(buf, box.payloadStart, box.end);
  if (direct && isPlausibleChild(direct.type)) return box.payloadStart;
  const skipped = readBox(buf, box.payloadStart + 4, box.end);
  if (skipped && isPlausibleChild(skipped.type)) return box.payloadStart + 4;
  // Neither reads cleanly. Prefer the ISO layout, which is the common one.
  return box.payloadStart + 4;
}

function isPlausibleChild(type: string): boolean {
  return ['hdlr', 'keys', 'ilst', 'free', 'skip', 'ID32', 'mdta'].includes(type);
}

/**
 * The indices in `ilst` that Apple's `keys` box says are location fields.
 *
 * `keys` lists names in order; an `ilst` item's box type is its 1-based index
 * into that list rather than a readable name, so the two have to be read
 * together. An `ilst` alone cannot be interpreted.
 */
function locationKeyIndices(buf: Buffer, keys: Box): Set<number> {
  const indices = new Set<number>();
  // keys is a FullBox: version/flags, then a 4-byte entry count.
  const listStart = keys.payloadStart + 8;
  let index = 0;
  for (const entry of children(buf, listStart, keys.end)) {
    index += 1;
    // Each entry is [size][namespace][name]; the name is the rest.
    const name = buf.toString('utf8', entry.payloadStart, entry.end);
    if (LOCATION_KEYS.includes(name)) indices.add(index);
  }
  return indices;
}

/**
 * Every range of a `moov` box that holds location data.
 *
 * `moovBuffer` is the `moov` box itself, header included. `moovFileOffset` is
 * where that box starts in the file, so the ranges come back absolute and the
 * caller never has to do the arithmetic twice.
 */
export function locationRangesInMoov(
  moovBuffer: Buffer,
  moovFileOffset: number,
): ZeroRange[] {
  const ranges: ZeroRange[] = [];
  const moov = readBox(moovBuffer, 0, moovBuffer.length);
  if (!moov || moov.type !== 'moov') return ranges;

  const zero = (box: Box, label: string) => {
    if (box.end <= box.payloadStart) return;
    ranges.push({
      start: moovFileOffset + box.payloadStart,
      end: moovFileOffset + box.end,
      label,
    });
  };

  for (const top of children(moovBuffer, moov.payloadStart, moov.end)) {
    if (top.type === 'udta') {
      for (const item of children(moovBuffer, top.payloadStart, top.end)) {
        if (item.type === 'loci') zero(item, 'udta/loci');
        else if (isXyz(item.type)) zero(item, 'udta/©xyz');
        else if (item.type === 'meta') collectMeta(moovBuffer, item, zero);
      }
    } else if (top.type === 'meta') {
      collectMeta(moovBuffer, top, zero);
    }
  }

  return ranges;
}

function isXyz(type: string): boolean {
  return Buffer.from(type, 'latin1').equals(XYZ);
}

function collectMeta(buf: Buffer, meta: Box, zero: (box: Box, label: string) => void): void {
  const start = metaChildrenStart(buf, meta);
  const kids = children(buf, start, meta.end);
  const keys = kids.find((box) => box.type === 'keys');
  const ilst = kids.find((box) => box.type === 'ilst');
  if (!ilst) return;

  const byIndex = keys ? locationKeyIndices(buf, keys) : new Set<number>();

  let index = 0;
  for (const item of children(buf, ilst.payloadStart, ilst.end)) {
    index += 1;
    const named = isXyz(item.type);
    // An item's type is either a four-character name or its 1-based index into
    // the keys list, stored as a big-endian integer in the same four bytes.
    const asIndex = Buffer.from(item.type, 'latin1').readUInt32BE(0);
    if (!named && !byIndex.has(asIndex) && !byIndex.has(index)) continue;

    // Zero the value inside the item's `data` box rather than the item itself,
    // so the key and the box structure survive and only the coordinates go.
    const dataBox = children(buf, item.payloadStart, item.end).find((b) => b.type === 'data');
    if (dataBox) zero(dataBox, named ? 'ilst/©xyz' : 'ilst/apple-location');
    else zero(item, 'ilst/item');
  }
}

/**
 * Find `moov` by walking the top-level boxes, using a reader that fetches a
 * range on demand.
 *
 * `moov` is at the start of a "fast start" file and at the end of most
 * straight-off-the-phone ones, so this cannot assume either. Only box headers
 * are read — eight or sixteen bytes each — so finding a `moov` past a 250 MB
 * `mdat` costs two requests rather than a download.
 */
export async function findMoov(
  fileSize: number,
  read: (start: number, end: number) => Promise<Buffer>,
): Promise<{ start: number; size: number } | null> {
  let at = 0;
  // A pathological file could chain many tiny boxes; stop rather than loop.
  for (let guard = 0; guard < 64 && at + HEADER <= fileSize; guard += 1) {
    const header = await read(at, Math.min(at + 16, fileSize));
    if (header.length < HEADER) return null;

    // Parsed here rather than through readBox, which refuses a box whose
    // declared size runs past the buffer it was handed. That is the right
    // check when walking a complete buffer and the wrong one here: these are
    // sixteen bytes off the front of a box that may be 250 MB long.
    const type = header.toString('latin1', 4, 8);
    const size32 = header.readUInt32BE(0);
    let size = size32;
    if (size32 === 1) {
      if (header.length < 16) return null;
      const large = header.readBigUInt64BE(8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
    } else if (size32 === 0) {
      // Runs to the end of the file. Nothing follows it.
      size = fileSize - at;
    }
    if (size < HEADER || at + size > fileSize) return null;

    if (type === 'moov') return { start: at, size };
    at += size;
  }
  return null;
}

/**
 * Overwrite the given ranges with zeroes as bytes stream past.
 *
 * Stateful across chunks: `consumed` is how many bytes of the file have already
 * gone by, so a range spanning a chunk boundary is still handled. Returns the
 * same buffer, patched in place.
 */
export function patchChunk(chunk: Buffer, consumed: number, ranges: readonly ZeroRange[]): Buffer {
  const chunkEnd = consumed + chunk.length;
  for (const range of ranges) {
    if (range.end <= consumed || range.start >= chunkEnd) continue;
    const from = Math.max(range.start, consumed) - consumed;
    const to = Math.min(range.end, chunkEnd) - consumed;
    chunk.fill(0, from, to);
  }
  return chunk;
}

/** Whether the first bytes look like an MP4 or QuickTime file. */
export function isMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const type = Buffer.from(bytes.subarray(4, 8)).toString('latin1');
  // `ftyp` is the normal case. Some MOV files lead with other top-level boxes.
  return type === 'ftyp' || type === 'moov' || type === 'mdat' || type === 'wide';
}
