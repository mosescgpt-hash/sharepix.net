import { readFileSync } from 'fs';
import { join } from 'path';
import {
  guestMayView,
  isEventPhotoKey,
  photoStemOf,
  withheldPhotoStems,
} from '../amplify/functions/media-url/access';

const E = 'evt-1';
const orig = (n: string) => `events/${E}/photos/${n}.jpg`;
const prev = (n: string) => `events/${E}/previews/${n}-preview.jpg`;
const thumb = (n: string) => `events/${E}/thumbs/${n}-thumb.jpg`;

describe('guest visibility of screened/hidden photos in media-url', () => {
  it('matches the gallery rule: hidden or flagged is not viewable', () => {
    expect(guestMayView({ approved: true, moderationStatus: 'clean' })).toBe(true);
    expect(guestMayView({})).toBe(true);
    expect(guestMayView({ approved: false })).toBe(false);
    expect(guestMayView({ moderationStatus: 'flagged' })).toBe(false);
    expect(guestMayView({ moderationStatus: 'released' })).toBe(true);
  });

  it('gives all three variants of one photo the same stem', () => {
    expect(photoStemOf(orig('abc'))).toBe(`${E}/abc`);
    expect(photoStemOf(prev('abc'))).toBe(`${E}/abc`);
    expect(photoStemOf(thumb('abc'))).toBe(`${E}/abc`);
    expect(photoStemOf(`events/${E}/cover/x.jpg`)).toBe('');
    expect(photoStemOf('pro/evt-1/previews/x')).toBe('');
  });

  it('only checks uploaded photo keys', () => {
    expect(isEventPhotoKey(orig('a'))).toBe(true);
    expect(isEventPhotoKey(prev('a'))).toBe(true);
    expect(isEventPhotoKey(thumb('a'))).toBe(true);
    expect(isEventPhotoKey(`events/${E}/cover/a.jpg`)).toBe(false);
  });

  it('withholds every variant of a flagged photo, even when the row lacks derived keys', () => {
    const withheld = withheldPhotoStems([{ s3Key: orig('bad'), moderationStatus: 'flagged' }]);
    for (const key of [orig('bad'), prev('bad'), thumb('bad')]) {
      expect(withheld.has(photoStemOf(key))).toBe(true);
    }
  });

  it('withholds a photo the host hid', () => {
    const withheld = withheldPhotoStems([{ s3Key: orig('hid'), approved: false }]);
    expect(withheld.has(photoStemOf(thumb('hid')))).toBe(true);
  });

  it('does not withhold visible or released photos', () => {
    const withheld = withheldPhotoStems([
      { s3Key: orig('ok'), approved: true, moderationStatus: 'clean' },
      { s3Key: orig('rel'), moderationStatus: 'released' },
      { s3Key: orig('bad'), moderationStatus: 'flagged' },
    ]);
    expect(withheld.has(photoStemOf(orig('ok')))).toBe(false);
    expect(withheld.has(photoStemOf(prev('rel')))).toBe(false);
    expect(withheld.size).toBe(1);
  });
});

describe('handler wiring', () => {
  const src = readFileSync(join(__dirname, '../amplify/functions/media-url/handler.ts'), 'utf8');
  it('applies the withheld check to non-hosts only, and fails closed', () => {
    expect(src).toMatch(/!host && keys\.some\(isEventPhotoKey\)/);
    expect(src).toMatch(/withheld === 'all'/);
    expect(src).toMatch(/return 'all';/);
  });
});

describe('live slideshow page', () => {
  const src = readFileSync(join(__dirname, '../pages/event/[eventId]/live.tsx'), 'utf8');
  it('reads photos through the guest query that drops hidden and flagged photos', () => {
    expect(src).toMatch(/fetchEventPhotoRecords\(eventId\)/);
    expect(src).not.toMatch(/fetchAllEventPhotos|models\.Photo/);
  });
  it('the guest query filters hidden photos client-side too', () => {
    const api = readFileSync(join(__dirname, '../lib/api.ts'), 'utf8');
    const fn = api.slice(api.indexOf('export async function fetchEventPhotoRecords'));
    expect(fn.slice(0, 1500)).toMatch(/listEventPhotos/);
    expect(fn.slice(0, 1500)).toMatch(/approved !== false/);
  });
});
