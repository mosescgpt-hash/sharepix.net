import { cameraClockMs, exifCaptureTime } from '../lib/captureTime';
import {
  MAX_FUTURE_SKEW_MS,
  boothScanKey as processorKey,
  photoInstant,
} from '../amplify/functions/process-pro-photo/boothMatch';
import {
  MAX_CLOCK_OFFSET_MS,
  boothScanKey as scannerKey,
  isBoothToken,
  validClockOffset,
} from '../amplify/functions/booth-scan/rules';
import { boothQrPayload, tokenFromBoothQr } from '../lib/booth';
import { codeOnly, readSource } from './sourceGuards';

/** A minimal JPEG whose EXIF holds one DateTimeOriginal, in either byte order. */
function jpegWithCaptureTime(text: string, little: boolean, original = true): Uint8Array {
  const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n: number) =>
    little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const ascii = [...text].map((c) => c.charCodeAt(0)).concat(0);
  // TIFF: header (8) + IFD0 with one entry (2+12+4=18) + Exif IFD with one entry (18) + string (20).
  const ifd0At = 8;
  const exifAt = ifd0At + 18;
  const stringAt = exifAt + 18;
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(ifd0At),
    // IFD0: one entry
    ...u16(1),
    ...(original
      ? [...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt)]
      : [...u16(0x0132), ...u16(2), ...u32(20), ...u32(stringAt)]),
    ...u32(0),
    // Exif IFD: DateTimeOriginal
    ...u16(1),
    ...u16(0x9003),
    ...u16(2),
    ...u32(20),
    ...u32(stringAt),
    ...u32(0),
    ...ascii,
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, ...app1, 0xff, 0xda, 0, 2]);
}

describe('reading when a photo was taken', () => {
  it('finds DateTimeOriginal in both byte orders', () => {
    expect(exifCaptureTime(jpegWithCaptureTime('2026:01:07 14:03:22', true))).toBe('2026:01:07 14:03:22');
    expect(exifCaptureTime(jpegWithCaptureTime('2026:01:07 14:03:22', false))).toBe('2026:01:07 14:03:22');
  });

  it('falls back to DateTime when there is no Exif IFD', () => {
    expect(exifCaptureTime(jpegWithCaptureTime('2026:01:07 09:00:00', true, false))).toBe('2026:01:07 09:00:00');
  });

  it('returns null for anything that is not a JPEG with a time', () => {
    expect(exifCaptureTime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(exifCaptureTime(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeNull();
    expect(exifCaptureTime(jpegWithCaptureTime('not a date at all!!', true))).toBeNull();
    // Truncated part-way through the metadata.
    expect(exifCaptureTime(jpegWithCaptureTime('2026:01:07 14:03:22', true).slice(0, 30))).toBeNull();
  });

  it('reads the camera clock as wall time, without guessing a zone', () => {
    expect(cameraClockMs('2026:01:07 14:03:22')).toBe(Date.UTC(2026, 0, 7, 14, 3, 22));
    expect(cameraClockMs('2026:13:07 14:03:22')).toBeNull();
  });
});

describe('matching a photo to a moment', () => {
  const uploadedAtMs = Date.UTC(2026, 0, 7, 15, 0, 0);

  it('uses the corrected capture time when it is believable', () => {
    // Camera set to local time, six hours ahead of UTC.
    const offsetMs = 6 * 60 * 60 * 1000;
    const result = photoInstant({ captureText: '2026:01:07 20:55:00', offsetMs, uploadedAtMs });
    expect(result).toEqual({ atMs: Date.UTC(2026, 0, 7, 14, 55, 0), match: 'capture' });
  });

  it('falls back to the upload time without a capture time or an offset', () => {
    expect(photoInstant({ captureText: null, offsetMs: 0, uploadedAtMs }).match).toBe('upload');
    expect(photoInstant({ captureText: '2026:01:07 14:55:00', offsetMs: null, uploadedAtMs }).match).toBe('upload');
  });

  it('distrusts a capture time from the future or from days ago', () => {
    const future = new Date(uploadedAtMs + MAX_FUTURE_SKEW_MS + 60_000);
    const text = `${future.getUTCFullYear()}:${String(future.getUTCMonth() + 1).padStart(2, '0')}:${String(
      future.getUTCDate(),
    ).padStart(2, '0')} ${String(future.getUTCHours()).padStart(2, '0')}:${String(future.getUTCMinutes()).padStart(
      2,
      '0',
    )}:00`;
    expect(photoInstant({ captureText: text, offsetMs: 0, uploadedAtMs }).match).toBe('upload');
    expect(photoInstant({ captureText: '2025:01:01 00:00:00', offsetMs: 0, uploadedAtMs }).match).toBe('upload');
  });

  it('keys scans the same way in the scanner and the processor', () => {
    expect(processorKey('e', 'p')).toBe(scannerKey('e', 'p'));
  });

  it('finds the latest scan at or before the photo, by the named index', () => {
    const processor = codeOnly(readSource('amplify/functions/process-pro-photo/handler.ts'));
    expect(processor).toContain("KeyConditionExpression: 'scanKey = :key AND scannedAt <= :at'");
    expect(processor).toContain('ScanIndexForward: false');
    const schema = readSource('amplify/data/resource.ts');
    expect(schema).toContain("index('scanKey').sortKeys(['scannedAt']).name('boothScansByScanKey')");
    expect(schema).toContain("index('token').name('boothAttendeesByToken')");
  });

  it('keeps booth originals, because the original is the deliverable', () => {
    const processor = codeOnly(readSource('amplify/functions/process-pro-photo/handler.ts'));
    expect(processor).toContain("const keepOriginal = booth || p?.keepOriginals?.BOOL === true;");
  });
});

describe('scanning', () => {
  it('accepts exactly the tokens sign-up issues', () => {
    const token = 'Ab3_-Ab3_-Ab3_-Ab3_-';
    expect(isBoothToken(token)).toBe(true);
    expect(tokenFromBoothQr(boothQrPayload(token))).toBe(token);
    expect(isBoothToken('short')).toBe(false);
    expect(isBoothToken('has spaces in it here')).toBe(false);
  });

  it('accepts camera offsets within a day and a half', () => {
    expect(validClockOffset(5 * 60 * 60 * 1000)).toBe(true);
    expect(validClockOffset(-MAX_CLOCK_OFFSET_MS)).toBe(true);
    expect(validClockOffset(MAX_CLOCK_OFFSET_MS + 1)).toBe(false);
    expect(validClockOffset(1.5)).toBe(false);
  });

  it('never lets a guessed clock replace a measured one', () => {
    const handler = codeOnly(readSource('amplify/functions/booth-scan/handler.ts'));
    expect(handler).toContain("'attribute_not_exists(boothClockSynced) OR boothClockSynced = :false'");
  });

  it('refuses a code from another event', () => {
    const handler = codeOnly(readSource('amplify/functions/booth-scan/handler.ts'));
    expect(handler).toContain('attendee.eventId?.S !== eventId');
  });

  it('keeps scans admin-only outside the functions', () => {
    const schema = readSource('amplify/data/resource.ts');
    const model = schema.slice(schema.indexOf('BoothScan: a'), schema.indexOf('GuestBookEntry: a'));
    expect(model).toContain(".authorization((allow) => [allow.group('ADMINS')])");
  });
});

describe('booth photos reach the shared gallery only as event or category photos', () => {
  const decide = codeOnly(readSource('amplify/functions/decide-pro-photo/handler.ts'));

  it('refuses to publish a person, stopped or unmatched photo', () => {
    expect(decide).toContain("if (boothPhoto && !boothToGallery && target === 'published')");
  });

  it('publishes event and category photos on approval', () => {
    expect(decide).toMatch(/boothToGallery && decision === 'approve' && target === 'approved'/);
  });
});
