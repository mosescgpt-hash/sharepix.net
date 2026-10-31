/** @jest-environment jsdom */
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder });
const mediaUrls = jest.fn();
jest.mock('@/lib/dataClient', () => ({
  authModeFor: async () => 'identityPool',
  getClient: () => ({ queries: { mediaUrls: (...a: unknown[]) => mediaUrls(...a) } }),
}));

import { getPhotoDisplaySource } from '@/lib/api';
import type { QRPhoto } from '@/lib/types';

// Signed URLs are cached per key for ten minutes, so each test uses its own photo.
let n = 0;
let id = 'p0';
const k = (kind: 'photos' | 'previews' | 'thumbs') =>
  `events/e-display/${kind}/${id}${kind === 'previews' ? '-preview' : kind === 'thumbs' ? '-thumb' : ''}.jpg`;
const photo = (extra: Partial<QRPhoto> = {}) =>
  ({
    id,
    eventId: 'e-display',
    s3Key: k('photos'),
    previewS3Key: k('previews'),
    thumbS3Key: k('thumbs'),
    ...extra,
  }) as QRPhoto;

const signedOnly = (...keys: string[]) =>
  mediaUrls.mockImplementation(async (args: { keys: string[] }) => ({
    data: args.keys
      .filter((key) => keys.includes(key))
      .map((key) => ({ key, url: null, fallbackUrl: `https://s3.test/${key}` })),
  }));

beforeEach(() => {
  mediaUrls.mockReset();
  id = `p${++n}`;
});

describe('getPhotoDisplaySource', () => {
  it('prefers the preview', async () => {
    signedOnly(k('previews'), k('thumbs'));
    expect((await getPhotoDisplaySource(photo())).primary).toContain('-preview.jpg');
  });

  it('uses the thumbnail when the server will only sign that (downloads withheld, or past the full-size window)', async () => {
    signedOnly(k('thumbs'));
    expect((await getPhotoDisplaySource(photo())).primary).toContain('-thumb.jpg');
  });

  it('uses the original for a photo that has no preview', async () => {
    signedOnly(k('photos'));
    const source = await getPhotoDisplaySource(photo({ previewS3Key: null, thumbS3Key: null }));
    expect(source.primary).toContain(`/photos/${id}.jpg`);
  });

  it('asks for all the renditions in one request, not one per try', async () => {
    signedOnly(k('thumbs'));
    await getPhotoDisplaySource(photo());
    expect(mediaUrls).toHaveBeenCalledTimes(1);
  });

  it('throws when nothing could be signed', async () => {
    signedOnly();
    await expect(getPhotoDisplaySource(photo())).rejects.toThrow('not available');
  });
});
