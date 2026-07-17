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

/** Hosts may download on every plan. Guests may download only on Premium. */
export function canDownloadEventMedia(tier: string, host: boolean): boolean {
  return host || tier.toLowerCase() === 'premium';
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
