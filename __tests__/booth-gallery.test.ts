import {
  MAX_GALLERY_PHOTOS,
  downloadName,
  inGallery,
  isGalleryKey,
} from '../amplify/functions/booth-gallery/gallery';
import { boothGalleryPath } from '../lib/booth';
import { codeOnly, readSource } from './sourceGuards';

describe('who sees what in a booth gallery', () => {
  it('shows a photo only to its recipients, and only once approved', () => {
    expect(inGallery({ recipients: ['a', 'b'], publishStatus: 'approved' }, 'b')).toBe(true);
    expect(inGallery({ recipients: ['a'], publishStatus: 'approved' }, 'b')).toBe(false);
    expect(inGallery({ recipients: ['a'], publishStatus: 'awaiting_review' }, 'a')).toBe(false);
    expect(inGallery({ recipients: ['a'], publishStatus: 'rejected' }, 'a')).toBe(false);
  });

  it('accepts only keys shaped like the ones sign-up issues', () => {
    expect(isGalleryKey('A'.repeat(32))).toBe(true);
    expect(isGalleryKey('short')).toBe(false);
    expect(isGalleryKey(`${'A'.repeat(31)}/`)).toBe(false);
    expect(boothGalleryPath('k')).toBe('/booth/photos/k');
  });

  it('names downloads safely', () => {
    expect(downloadName('Acme @ CES "2027"', 0, 'image/jpeg')).toBe('Acme-CES-2027-001.jpg');
    expect(downloadName('', 11, 'image/heic')).toBe('photo-012.heic');
  });

  it('caps a gallery at a booth-sized number of photos', () => {
    expect(MAX_GALLERY_PHOTOS).toBe(300);
  });
});

describe('the gallery function', () => {
  const handler = codeOnly(readSource('amplify/functions/booth-gallery/handler.ts'));

  it('finds the attendee by the gallery key, never by the QR token', () => {
    expect(handler).toContain("IndexName: ATTENDEES_BY_GALLERY_KEY");
    expect(handler).not.toContain('boothAttendeesByToken');
    const schema = readSource('amplify/data/resource.ts');
    expect(schema).toContain("index('galleryKey').name('boothAttendeesByGalleryKey')");
  });

  it('only serves booth events that are not closed', () => {
    expect(handler).toContain("ev.Item.boothMode?.BOOL !== true || ev.Item.takenDownAt?.S");
  });

  it('can read under pro/ and nothing else in the bucket', () => {
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain("bucket.grantRead(boothGalleryFn, 'pro/*')");
  });
});

describe('gallery keys at sign-up', () => {
  const signup = codeOnly(readSource('amplify/functions/booth-signup/handler.ts'));

  it('issues a key separate from the QR token', () => {
    expect(signup).toContain('galleryKey: { S: newGalleryKey() }');
    expect(signup).toContain("randomBytes(24).toString('base64url')");
  });
});

describe('booth originals lose their location before anyone downloads them', () => {
  const processor = codeOnly(readSource('amplify/functions/process-pro-photo/handler.ts'));

  it('strips them during processing, with the same code as guest uploads', () => {
    expect(processor).toContain('stripJpegMetadata(source)');
    expect(processor).toContain('stripHeicGps(source)');
    expect(processor).toMatch(/if \(booth\) \{[\s\S]*stripJpegMetadata/);
  });
});
