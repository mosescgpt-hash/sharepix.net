/**
 * Moments: the named parts of an event.
 *
 * "Getting ready", "Ceremony", "Reception". A moment is a label a host defines
 * up front; a photo optionally belongs to one, and each moment can print its
 * own QR code so the card on the ceremony chairs files photos differently from
 * the card on the dinner tables.
 *
 * The whole design is ADDITIVE, which is why this is safe to ship on top of
 * live events:
 *
 * - A photo with no `momentId` is valid and always has been. Every existing
 *   photo is in that state and nothing reinterprets it.
 * - A photo whose `momentId` points at a moment the host later deleted is also
 *   valid — `resolveMomentId` folds it back to "no moment" rather than
 *   stranding it somewhere nothing can show it.
 * - No tier gate. The audit flagged that tier strings are already load-bearing
 *   in five places; adding a sixth to sell a labelling feature would cost more
 *   than the feature earns.
 *
 * The text rules below are deliberately a copy of the shape used in
 * `lib/guestBook.ts` rather than an import of it: this file is duplicated
 * verbatim into the Lambda that writes moments (functions bundle separately
 * and cannot import from `lib/`), and a copy that reaches across to another
 * module cannot be duplicated that way.
 */

export const MAX_MOMENT_NAME_LENGTH = 60;
export const MAX_MOMENT_DESCRIPTION_LENGTH = 200;

/**
 * An abuse ceiling on the write endpoint, and a usability one. Past roughly a
 * dozen the picker a guest sees at the top of the upload page stops being a
 * choice and becomes a form.
 */
export const MAX_MOMENTS_PER_EVENT = 24;

export interface MomentInput {
  name?: string | null;
  description?: string | null;
  sortOrder?: number | null;
}

export interface CleanMoment {
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface MomentLike {
  id: string;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  createdAt?: string | null;
}

/**
 * Drop the characters that are invisible in a gallery but meaningful to
 * something downstream — C0, DEL and C1 — while keeping tab and newline, which
 * the collapse step below handles as whitespace.
 *
 * Written as a scan rather than a regex on purpose: a character-class regex of
 * escapes is the kind of thing that gets miscopied into the Lambda duplicate,
 * and this version is the same in both files and readable in both.
 */
export function stripControlCharacters(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10) {
      out += char;
      continue;
    }
    if (code < 32) continue;
    if (code >= 127 && code <= 159) continue;
    out += char;
  }
  return out;
}

/** Strip, collapse runs of whitespace to one space, trim, and cap the length. */
export function cleanMomentText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return stripControlCharacters(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export type MomentValidation =
  | { ok: true; moment: CleanMoment }
  | { ok: false; reason: string };

/**
 * The one place a moment's fields are checked. The browser calls it to give
 * fast feedback; the Lambda calls its own copy and is the one that decides.
 */
export function validateMoment(input: MomentInput): MomentValidation {
  const name = cleanMomentText(input.name, MAX_MOMENT_NAME_LENGTH);
  if (!name) {
    return { ok: false, reason: 'Give this moment a name.' };
  }

  const description = cleanMomentText(input.description, MAX_MOMENT_DESCRIPTION_LENGTH);

  // A non-finite or negative order would sort unpredictably against the rows
  // that already exist, so it is clamped rather than rejected — the host did
  // not type this value, the UI did.
  const raw = typeof input.sortOrder === 'number' ? input.sortOrder : 0;
  const sortOrder = Number.isFinite(raw) ? Math.max(0, Math.min(9999, Math.round(raw))) : 0;

  return { ok: true, moment: { name, description: description || null, sortOrder } };
}

/**
 * Host order first, then oldest first as the tie-break. Two moments created in
 * the same drag with the same order must not swap places between renders.
 */
export function sortMoments<T extends MomentLike>(moments: T[]): T[] {
  return [...moments].sort((a, b) => {
    const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : 0;
    const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : 0;
    if (orderA !== orderB) return orderA - orderB;
    const timeA = a.createdAt ? Date.parse(a.createdAt) : 0;
    const timeB = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * The next `sortOrder` to hand a newly created moment: the end of the list.
 */
export function nextSortOrder(moments: MomentLike[]): number {
  let highest = -1;
  for (const moment of moments) {
    const order = typeof moment.sortOrder === 'number' ? moment.sortOrder : 0;
    if (order > highest) highest = order;
  }
  return Math.min(9999, highest + 1);
}

/**
 * Turn a claimed moment id into one we will actually store or filter by.
 *
 * Returns null for anything not in the event's own list — an empty string, a
 * value from a QR code printed for a moment the host has since deleted, or an
 * id belonging to somebody else's event. The caller then treats the photo as
 * having no moment, which is a valid state rather than an error.
 *
 * This is a convenience, NOT the security boundary. The server re-derives the
 * same answer from the moment's stored `eventId`; nothing here is trusted.
 */
export function resolveMomentId(
  claimed: string | null | undefined,
  moments: MomentLike[],
): string | null {
  if (typeof claimed !== 'string') return null;
  const trimmed = claimed.trim();
  if (!trimmed) return null;
  return moments.some((moment) => moment.id === trimmed) ? trimmed : null;
}

export interface PhotoLike {
  id: string;
  momentId?: string | null;
}

export interface MomentGroup<M extends MomentLike, P extends PhotoLike> {
  /** null for the trailing group of photos that belong to no moment. */
  moment: M | null;
  photos: P[];
}

/**
 * Group an event's photos under its moments, in the host's order, with
 * everything unassigned in a final group.
 *
 * Empty moments are kept: a host who set up "Speeches" and got nothing wants to
 * see that, and dropping it would make the gallery disagree with the QR codes
 * on the tables. The unassigned group is dropped when empty, because a group
 * with no label and no photos says nothing at all.
 */
export function groupPhotosByMoment<M extends MomentLike, P extends PhotoLike>(
  photos: P[],
  moments: M[],
): Array<MomentGroup<M, P>> {
  const ordered = sortMoments(moments);
  const known = new Set(ordered.map((moment) => moment.id));
  const buckets = new Map<string, P[]>();
  const loose: P[] = [];

  for (const photo of photos) {
    const id = typeof photo.momentId === 'string' ? photo.momentId : null;
    if (id && known.has(id)) {
      const bucket = buckets.get(id);
      if (bucket) bucket.push(photo);
      else buckets.set(id, [photo]);
    } else {
      // Includes photos pointing at a deleted moment. They are not lost.
      loose.push(photo);
    }
  }

  const groups: Array<MomentGroup<M, P>> = ordered.map((moment) => ({
    moment,
    photos: buckets.get(moment.id) ?? [],
  }));

  if (loose.length > 0) {
    groups.push({ moment: null, photos: loose });
  }
  return groups;
}

/** How many photos are filed under each moment, for the host's list. */
export function momentPhotoCounts(photos: PhotoLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const photo of photos) {
    const id = typeof photo.momentId === 'string' ? photo.momentId : null;
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The upload URL for one moment. A moment's QR code is the event's upload page
 * with the moment preselected, so scanning the card on the ceremony chairs
 * files a photo differently from the card on the dinner tables — without the
 * guest choosing anything.
 */
export function momentUploadPath(eventId: string, momentId?: string | null): string {
  const base = `/event/${eventId}/upload`;
  if (!momentId) return base;
  return `${base}?moment=${encodeURIComponent(momentId)}`;
}
