import { canDownloadEventMedia, isEventHost, sortGalleryPhotos } from '../lib/gallery';
import { DisplayPhoto, QREvent } from '../lib/types';

const event: QREvent = {
  id: 'event-1',
  name: 'Test event',
  eventCode: 'ABC123',
  tier: 'starter',
  owner: 'owner-sub::owner@example.com',
};

const photos: DisplayPhoto[] = [
  { id: '2', eventId: 'event-1', s3Key: 'b.jpg', url: 'b', uploadedBy: 'Zoe', createdAt: '2026-07-16T09:00:00.000Z' },
  { id: '1', eventId: 'event-1', s3Key: 'a.jpg', url: 'a', uploadedBy: 'Alex', createdAt: '2026-07-17T08:00:00.000Z' },
];

describe('gallery permissions', () => {
  test('hosts can download on every plan', () => {
    expect(canDownloadEventMedia('starter', true)).toBe(true);
    expect(canDownloadEventMedia('standard', true)).toBe(true);
  });

  test('guests can download only on premium', () => {
    expect(canDownloadEventMedia('starter', false)).toBe(false);
    expect(canDownloadEventMedia('standard', false)).toBe(false);
    expect(canDownloadEventMedia('premium', false)).toBe(true);
  });

  test('matches an Amplify owner value to the signed-in host', () => {
    expect(
      isEventHost(event, {
        userId: 'owner-sub',
        displayName: 'owner',
        loginId: 'owner@example.com',
      }),
    ).toBe(true);
  });
});

describe('gallery sorting', () => {
  test('sorts by uploader', () => {
    expect(sortGalleryPhotos(photos, 'uploader').map((photo) => photo.uploadedBy)).toEqual([
      'Alex',
      'Zoe',
    ]);
  });

  test('sorts by exact time', () => {
    expect(sortGalleryPhotos(photos, 'time-newest').map((photo) => photo.id)).toEqual(['1', '2']);
    expect(sortGalleryPhotos(photos, 'time-oldest').map((photo) => photo.id)).toEqual(['2', '1']);
  });
});
