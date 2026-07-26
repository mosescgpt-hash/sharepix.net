import { classifyDuplicate, duplicateMessage, hashFileContent } from '../lib/hash';
import { buildPhotoKey } from '../lib/validation';

describe('content hashing', () => {
  it('gives the same hash to identical bytes and different hashes to different bytes', async () => {
    const first = await hashFileContent(new Blob(['a wedding photo']));
    const second = await hashFileContent(new Blob(['a wedding photo']));
    const other = await hashFileContent(new Blob(['a different photo']));

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it('ignores the filename, so a renamed copy still matches', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const asJpg = new File([bytes], 'IMG_1234.jpg', { type: 'image/jpeg' });
    const renamed = new File([bytes], 'copy of IMG_1234.jpg', { type: 'image/jpeg' });

    expect(await hashFileContent(asJpg)).toBe(await hashFileContent(renamed));
  });
});

describe('duplicate classification', () => {
  const gallery = new Set(['aaa']);
  const batch = new Set(['bbb']);

  it('spots a file the gallery already has', () => {
    expect(classifyDuplicate('aaa', gallery, batch)).toBe('gallery');
  });

  it('spots a file picked twice in the same batch', () => {
    expect(classifyDuplicate('bbb', gallery, batch)).toBe('batch');
  });

  it('lets a new file through', () => {
    expect(classifyDuplicate('ccc', gallery, batch)).toBe('none');
  });

  it('lets an unhashed file through rather than blocking the upload', () => {
    expect(classifyDuplicate(null, gallery, batch)).toBe('none');
    expect(duplicateMessage('none')).toBeNull();
  });

  it('explains why a file was skipped', () => {
    expect(duplicateMessage('gallery')).toContain('Already in this gallery');
    expect(duplicateMessage('batch')).toContain('Same as another file');
  });
});

describe('content-addressed photo keys', () => {
  it('puts identical bytes at the same key no matter when they are uploaded', () => {
    const hash = 'f'.repeat(64);
    const monday = buildPhotoKey('evt', 'party.jpg', new Date('2026-01-01T00:00:00Z'), hash);
    const friday = buildPhotoKey('evt', 'party.jpg', new Date('2026-01-05T00:00:00Z'), hash);

    expect(monday).toBe(friday);
    expect(monday).toBe(`events/evt/photos/${'f'.repeat(32)}-party.jpg`);
  });

  it('falls back to a timestamp when the file could not be hashed', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(buildPhotoKey('evt', 'party.jpg', now, null)).toBe(
      `events/evt/photos/${now.getTime()}-party.jpg`,
    );
  });
});
