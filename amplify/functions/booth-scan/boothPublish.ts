/**
 * Which approved booth photos reach the event's shared gallery
 * (docs/booth-mode.md, "Shared gallery").
 *
 *   Event and category photos (no one person): published when approved,
 *   grouped by category in the gallery.
 *   A person's photos: private to that person, never published.
 *   Stopped, unsorted and divider photos: never, unless the host moves them
 *   into the event or a category.
 *
 * Byte-identical in amplify/functions/{booth-scan,decide-pro-photo}/. Pure.
 */

export function publishesToGallery(photo: {
  segment?: string | null;
  match?: string | null;
  divider?: boolean | null;
}): boolean {
  if (photo.divider || photo.match === 'divider') return false;
  return photo.segment === 'event' || photo.segment === 'category';
}

/**
 * After the host moves a booth photo: an approved one moved into the event or
 * a category joins the gallery; a published one moved anywhere else leaves it
 * (it stays approved, so a person it now belongs to still gets it).
 * Null means no change.
 */
export function statusAfterMove(
  publishStatus: string | null | undefined,
  toGallery: boolean,
): { publishStatus: 'published' | 'approved'; approved: boolean } | null {
  if (toGallery && publishStatus === 'approved') return { publishStatus: 'published', approved: true };
  if (!toGallery && publishStatus === 'published') return { publishStatus: 'approved', approved: false };
  return null;
}
