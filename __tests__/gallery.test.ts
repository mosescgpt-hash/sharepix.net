import {
  canDownloadEventMedia,
  galleryVariantFor,
  isEventHost,
  sortGalleryPhotos,
} from '../lib/gallery';
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
  test('hosts can download their own event', () => {
    expect(canDownloadEventMedia({ ...event }, true)).toBe(true);
  });

  test('guests can download too — downloads ship with every plan', () => {
    expect(canDownloadEventMedia({ ...event }, false)).toBe(true);
  });

  test('a host can withhold downloads from guests', () => {
    expect(canDownloadEventMedia({ ...event, guestDownloadsBlocked: true }, false)).toBe(false);
  });

  test('withholding never restricts the host — they keep their own photos', () => {
    expect(canDownloadEventMedia({ ...event, guestDownloadsBlocked: true }, true)).toBe(true);
  });

  test('an event with no setting is not blocked', () => {
    // Every event created before the toggle existed has no value here, and
    // must keep working exactly as it did.
    expect(canDownloadEventMedia({ ...event }, false)).toBe(true);
    expect(canDownloadEventMedia({ ...event, guestDownloadsBlocked: false }, false)).toBe(true);
    expect(canDownloadEventMedia({ ...event, guestDownloadsBlocked: null }, false)).toBe(true);
  });

  test('a blocked event serves guests the thumbnail, not the preview', () => {
    // Hiding the button alone would be theatre — the large image would still be
    // in the page. Withholding downloads means not sending the big file.
    expect(galleryVariantFor({ ...event, guestDownloadsBlocked: true }, false)).toBe('thumb');
    expect(galleryVariantFor({ ...event, guestDownloadsBlocked: true }, true)).toBe('preview');
    expect(galleryVariantFor({ ...event }, false)).toBe('preview');
  });

  test('the retired guest-download flag no longer withholds downloads', () => {
    // Events sold before downloads were included still carry the old flag, set
    // either way. Neither value may now block a guest.
    expect(canDownloadEventMedia({ ...event, guestDownloadEnabled: false }, false)).toBe(true);
    expect(canDownloadEventMedia({ ...event, guestDownloadEnabled: true }, false)).toBe(true);
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
