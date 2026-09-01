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
 * Who may download an event's media. Everyone who can see the gallery can —
 * guest downloads are included on every plan rather than sold as an add-on,
 * which is what every comparable service does and what guests expect.
 *
 * The `event` and `host` arguments are kept because callers pass them and
 * because any future per-event restriction belongs here rather than scattered
 * across the pages that render download buttons.
 */
export function canDownloadEventMedia(_event: QREvent, _host: boolean): boolean {
  return true;
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
