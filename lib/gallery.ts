import type { CurrentUser } from '@/lib/api';
import type { DisplayPhoto, QREvent } from '@/lib/types';

export type GallerySort =
  | 'date-newest'
  | 'date-oldest'
  | 'time-newest'
  | 'time-oldest'
  | 'uploader';

export function isEventHost(event: QREvent, user: CurrentUser | null): boolean {
  return !!user && !!event.owner && event.owner.includes(user.userId);
}

/**
 * Who may download an event's media.
 *
 * Downloads are included on every plan, so the default is yes for everyone who
 * can see the gallery. A host can withhold them from guests for a particular
 * event — a private memorial, a corporate event under an image policy — and
 * that is what `guestDownloadsBlocked` records.
 *
 * The host is never restricted: it is their event and their photos to keep.
 * A missing flag means downloads are on, so events created before the toggle
 * existed keep working.
 */
export function canDownloadEventMedia(event: QREvent, host: boolean): boolean {
  if (host) return true;
  return event.guestDownloadsBlocked !== true;
}

/**
 * Which stored variant a viewer is shown in the gallery.
 *
 * A guest of an event with downloads withheld gets the 480px thumbnail rather
 * than the 1280px preview. Hiding the download button alone would be theatre —
 * the image is right there in the page and can be saved from any browser — so
 * the honest version of "no downloads" is to not send the large file at all.
 *
 * This is not DRM and should never be described as such to a host: a
 * screenshot still works, and the thumbnail is still a real picture. It lowers
 * what a guest can walk away with, which is what a host asking for this
 * actually wants.
 */
export function galleryVariantFor(event: QREvent, host: boolean): 'preview' | 'thumb' {
  return canDownloadEventMedia(event, host) ? 'preview' : 'thumb';
}

function createdAt(photo: DisplayPhoto): string {
  return photo.createdAt ?? '';
}

function uploader(photo: DisplayPhoto): string {
  return (photo.uploadedBy || 'Anonymous').toLocaleLowerCase();
}

export function sortGalleryPhotos(photos: DisplayPhoto[], sort: GallerySort): DisplayPhoto[] {
  return [...photos].sort((a, b) => {
    if (sort === 'uploader') {
      return uploader(a).localeCompare(uploader(b)) || createdAt(b).localeCompare(createdAt(a));
    }

    if (sort.startsWith('date-')) {
      const direction = sort === 'date-newest' ? -1 : 1;
      const dateComparison = createdAt(a).slice(0, 10).localeCompare(createdAt(b).slice(0, 10));
      return dateComparison * direction || createdAt(b).localeCompare(createdAt(a));
    }

    const direction = sort === 'time-newest' ? -1 : 1;
    return createdAt(a).localeCompare(createdAt(b)) * direction;
  });
}
