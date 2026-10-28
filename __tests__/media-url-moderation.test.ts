import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isEventPhotoKey,
  photoStemOf,
  visibleStemsAndIds,
} from '../amplify/functions/media-url/access';
import { photoVisibleTo, type PhotoRowFacts } from '../amplify/functions/media-url/visibility';

/** A guest looking at an 'everyone' gallery: the ordinary case. */
const guest = {
  identity: null,
  audience: 'everyone' as const,
  callerId: '',
  privileged: false,
  shared: null,
};
const visible = (rows: PhotoRowFacts[], ctx = guest) => visibleStemsAndIds(rows, ctx);

const E = 'evt-1';
const orig = (n: string) => `events/${E}/photos/${n}.jpg`;
const prev = (n: string) => `events/${E}/previews/${n}-preview.jpg`;
const thumb = (n: string) => `events/${E}/thumbs/${n}-thumb.jpg`;

describe('guest visibility of screened/hidden photos in media-url', () => {
  it('matches the gallery rule: hidden, flagged or held is not viewable', () => {
    expect(photoVisibleTo({ approved: true, moderationStatus: 'ok' }, guest)).toBe(true);
    expect(photoVisibleTo({}, guest)).toBe(true);
    expect(photoVisibleTo({ approved: false }, guest)).toBe(false);
    expect(photoVisibleTo({ moderationStatus: 'flagged' }, guest)).toBe(false);
    expect(photoVisibleTo({ moderationStatus: 'released' }, guest)).toBe(true);
    // A guest's video waits for the host, for the host as well: the dashboard
    // reads the Photo model directly, and the slideshow never shows it.
    expect(photoVisibleTo({ s3Key: 'a.mp4', moderationStatus: 'held' }, guest)).toBe(false);
    expect(photoVisibleTo({ s3Key: 'a.mp4', moderationStatus: 'held' }, { ...guest, privileged: true })).toBe(false);
    expect(photoVisibleTo({ s3Key: 'a.mp4', moderationStatus: 'released' }, guest)).toBe(true);
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

  it('signs no variant of a flagged photo, even when the row lacks derived keys', () => {
    const { stems } = visible([{ id: '1', s3Key: orig('bad'), moderationStatus: 'flagged' }]);
    for (const key of [orig('bad'), prev('bad'), thumb('bad')]) {
      expect(stems.has(photoStemOf(key))).toBe(false);
    }
  });

  it('signs nothing for a photo the host hid, or a video still held', () => {
    const { stems, ids } = visible([
      { id: 'h', s3Key: orig('hid'), approved: false },
      { id: 'v', s3Key: `events/${E}/photos/vid.mp4`, moderationStatus: 'held' },
    ]);
    expect(stems.has(photoStemOf(thumb('hid')))).toBe(false);
    expect(stems.has(`${E}/vid`)).toBe(false);
    expect(ids.size).toBe(0);
  });

  it('signs a visible or released photo in all three variants, and only those', () => {
    const { stems, ids } = visible([
      { id: 'a', s3Key: orig('ok'), previewS3Key: prev('ok'), thumbS3Key: thumb('ok'), approved: true, moderationStatus: 'ok' },
      { id: 'b', s3Key: orig('rel'), moderationStatus: 'released' },
      { id: 'c', s3Key: orig('bad'), moderationStatus: 'flagged' },
    ]);
    expect(stems.has(photoStemOf(thumb('ok')))).toBe(true);
    expect(stems.has(photoStemOf(prev('rel')))).toBe(true);
    expect(stems.has(photoStemOf(orig('bad')))).toBe(false);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('shows a guest only their own photos when the host chose that', () => {
    const rows: PhotoRowFacts[] = [
      { id: 'mine', s3Key: orig('mine'), uploaderId: 'g1' },
      { id: 'theirs', s3Key: orig('theirs'), uploaderId: 'g2' },
    ];
    const { ids } = visible(rows, { ...guest, audience: 'own' as never, callerId: 'g1' });
    expect([...ids]).toEqual(['mine']);
  });
});

describe('handler wiring', () => {
  const src = readFileSync(join(__dirname, '../amplify/functions/media-url/handler.ts'), 'utf8');
  it('applies the withheld check to non-hosts only, and fails closed', () => {
    // An allow-list, not a deny-list: a key whose photo is not on it is not
    // signed, so a read that fails closes the gallery rather than opening it.
    expect(src).toMatch(/visible\?\.stems\.has\(photoStemOf\(key\)\) \?\? false/);
    expect(src).toMatch(/gate === 'open'/);
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
