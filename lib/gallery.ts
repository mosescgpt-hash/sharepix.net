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
 * Hosts (and admins) may always download their own event. Guests may download
 * only when the event has the guest-download add-on enabled — a Corporate-only,
 * per-event purchase. Off by default on every plan.
 */
export function canDownloadEventMedia(event: QREvent, host: boolean): boolean {
  return host || event.guestDownloadEnabled === true;
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
