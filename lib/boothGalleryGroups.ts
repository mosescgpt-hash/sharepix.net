/**
 * Booth categories in the shared gallery (docs/booth-mode.md, "Shared gallery").
 *
 * Approved event and category photos from a booth are published to the
 * event's gallery. The gallery already groups by moments; a booth category
 * becomes one more group, after the host's own moments, so a host with
 * neither sees exactly the gallery they had. A photo the host filed under a
 * moment stays there.
 */
import type { MomentLike } from './moments';

export const BOOTH_CATEGORY_GROUP_PREFIX = 'booth-category:';

export function withBoothCategories<M extends MomentLike, P extends { momentId?: string | null; boothCategoryName?: string | null }>(
  photos: P[],
  moments: M[],
): { photos: P[]; moments: MomentLike[] } {
  const names: string[] = [];
  const out = photos.map((photo) => {
    const name = (photo.boothCategoryName ?? '').trim();
    if (!name || photo.momentId) return photo;
    if (!names.includes(name)) names.push(name);
    return { ...photo, momentId: `${BOOTH_CATEGORY_GROUP_PREFIX}${name}` };
  });
  const last = moments.reduce((max, m) => Math.max(max, m.sortOrder ?? 0), 0);
  const extra: MomentLike[] = names.map((name, i) => ({
    id: `${BOOTH_CATEGORY_GROUP_PREFIX}${name}`,
    name,
    description: null,
    sortOrder: last + 1 + i,
  }));
  return { photos: out, moments: [...moments, ...extra] };
}
