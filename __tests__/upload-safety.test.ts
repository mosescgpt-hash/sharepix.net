import {
  sniffMediaKind,
  isAllowedUploadContent,
  maxBytesForKind,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from '../amplify/functions/sanitize-upload/safety';

const bytes = (...vals: number[]) => new Uint8Array(vals);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

function ftyp(brand: string): Uint8Array {
  // size (4) + "ftyp" (4) + brand (4)
  return new Uint8Array([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand), 0, 0, 0, 0]);
}

describe('sniffMediaKind', () => {
  it('recognizes the image formats the app accepts', () => {
    expect(sniffMediaKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image'); // JPEG
    expect(sniffMediaKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image'); // PNG
    expect(sniffMediaKind(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image'); // GIF
    expect(sniffMediaKind(new Uint8Array([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')]))).toBe('image');
    expect(sniffMediaKind(ftyp('heic'))).toBe('image');
    expect(sniffMediaKind(ftyp('avif'))).toBe('image');
  });

  it('recognizes the video formats the app accepts', () => {
    expect(sniffMediaKind(ftyp('mp42'))).toBe('video'); // MP4
    expect(sniffMediaKind(ftyp('qt  '))).toBe('video'); // MOV
    expect(sniffMediaKind(ftyp('3gp4'))).toBe('video');
    expect(sniffMediaKind(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video'); // WebM
  });

  it('rejects disguised non-media content', () => {
    expect(sniffMediaKind(new Uint8Array(ascii('<!DOCTYPE html>')))).toBeNull();
    expect(sniffMediaKind(new Uint8Array(ascii('<svg xmlns=')))).toBeNull();
    expect(sniffMediaKind(new Uint8Array(ascii('%PDF-1.7')))).toBeNull();
    expect(sniffMediaKind(new Uint8Array(ascii('PK')))).toBeNull(); // zip/office
    expect(sniffMediaKind(new Uint8Array(ascii('MZ')))).toBeNull(); // exe
    expect(sniffMediaKind(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
    expect(sniffMediaKind(new Uint8Array())).toBeNull();
  });

  it('isAllowedUploadContent mirrors the sniff result', () => {
    expect(isAllowedUploadContent(bytes(0xff, 0xd8, 0xff))).toBe(true);
    expect(isAllowedUploadContent(new Uint8Array(ascii('<html>')))).toBe(false);
  });
});

describe('maxBytesForKind', () => {
  it('caps images and videos separately', () => {
    expect(maxBytesForKind('image')).toBe(MAX_IMAGE_BYTES);
    expect(maxBytesForKind('video')).toBe(MAX_VIDEO_BYTES);
  });
});
