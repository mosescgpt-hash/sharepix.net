/**
 * Likes and comments on a photo.
 *
 * ## What a "like" actually is, and what it is not
 *
 * Guests have no accounts. There is no login, and that is the product — so a
 * like is keyed by a value the browser generates and sends, which means a
 * determined person can send a hundred of them.
 *
 * **This is a soft count and is described as one.** It is decoration on a
 * gallery of a party, not a vote, not a ranking that decides anything, and not
 * a number any business decision reads. Engineering it into something
 * tamper-proof would mean identifying guests, which is the one thing SharePix
 * promises not to make them do.
 *
 * The protections that actually matter are elsewhere: a host can switch the
 * whole thing off, a host can delete any comment, and nothing here feeds a
 * metric. `contributorCount` and `guestUploadCount` — the numbers that DO carry
 * weight — are still derived server-side from real uploads and are untouched by
 * any of this.
 *
 * ## Why both are switchable, and why that is not a technicality
 *
 * SharePix is used for memorials. A "like" button under a photograph at a
 * celebration of life is the wrong object in the room, and a comment thread
 * there is a different thing again — sometimes exactly right, sometimes not.
 * Neither belongs to us to decide, so both are switches the host controls, and
 * the host settings name the case rather than leaving them to work it out.
 *
 * They default ON: a photo gallery where you cannot say "this one" is a strange
 * gallery, and a default of off is a feature nobody finds. The cost of that
 * default is a memorial host having to turn something off, which is why the
 * switch is on the same screen as the gallery style rather than buried.
 *
 * ## Moderation
 *
 * Comments are free text written by anonymous people at a party. There is **no
 * automatic screening** of them: photo screening uses Rekognition, and text
 * screening is a different service, a new cost and a new failure mode. Saying
 * so plainly is better than implying a filter that does not exist.
 *
 * What exists instead: the host can hide any comment, comments are visible in
 * the host's dashboard, and the host can turn comments off entirely — which
 * also hides the ones already there rather than orphaning them.
 */

/** Longest comment accepted. A sentence or two under a photo, not an essay. */
export const MAX_COMMENT_LENGTH = 500;

/** Longest display name on a comment. Matches the upload flow's name field. */
export const MAX_COMMENT_AUTHOR = 60;

/**
 * Whether this event has likes at all.
 *
 * Absent means ON. Every event created before this existed has no value, and
 * the honest reading of that is "nobody has turned this off", not "off".
 */
export function likesEnabled(
  event: { reactionsEnabled?: boolean | null } | null | undefined,
): boolean {
  return event?.reactionsEnabled !== false;
}

/** Whether this event has comments at all. Absent means ON, as above. */
export function commentsEnabled(
  event: { commentsEnabled?: boolean | null } | null | undefined,
): boolean {
  return event?.commentsEnabled !== false;
}

/**
 * The row id for one browser's like on one photo.
 *
 * `<photoId>#<guestKey>` so a conditional put is the whole "one like per
 * browser" rule — no scanning, and no race between two taps.
 */
export function reactionId(photoId: string, guestKey: string): string {
  return `${photoId}#${guestKey}`;
}

/**
 * A guest key that is safe to use as a row id, or ''.
 *
 * Bounded and restricted to characters that cannot break a key. This is NOT a
 * credential and is not treated as one — it identifies a browser, badly, and
 * only for the purpose of not counting the same tap twice.
 */
export function normalizeGuestKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(trimmed)) return '';
  return trimmed;
}

/**
 * Clean a comment for storage, or ''.
 *
 * Control characters are stripped by scanning code points rather than by a
 * regular expression: a character class written with literal control bytes has
 * embedded those bytes into a source file in this codebase four times now.
 *
 * Note what this does NOT do: it does not escape anything. The comment is
 * rendered as a text node by React, never as markup, and pre-escaping here
 * would double-escape an apostrophe into the gallery.
 */
export function cleanComment(value: unknown, maxLength = MAX_COMMENT_LENGTH): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // Keep newline; drop tab and the rest of C0, DEL and C1. A comment under a
    // photo has no use for a tab, and it complicates every layout it lands in.
    if (code === 10) {
      out += char;
      continue;
    }
    if (code < 32 || (code >= 127 && code <= 159)) continue;
    out += char;
  }
  // Collapse runs of blank lines, so a comment cannot push the next one off
  // the screen with fifty newlines.
  return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength);
}

export interface CommentDecision {
  ok: boolean;
  reason?: string;
  body?: string;
  author?: string;
}

/**
 * Whether this comment may be stored, and what to store.
 *
 * The author name is optional: an unnamed comment is signed with the guest's
 * per-browser label by the caller, exactly like an unnamed upload. What is
 * refused is an empty body — a blank comment is a mis-tap, not a contribution.
 */
export function validateComment(input: {
  body?: unknown;
  author?: unknown;
}): CommentDecision {
  const body = cleanComment(input.body);
  if (!body) return { ok: false, reason: 'Write something first.' };
  const author = cleanComment(input.author, MAX_COMMENT_AUTHOR);
  return { ok: true, body, author };
}

export interface EngagementFacts {
  likeCount?: number | null;
  commentCount?: number | null;
}

/** Likes on a photo, floored at zero. A negative count is a bug on display. */
export function likeCountOf(photo: EngagementFacts | null | undefined): number {
  return Math.max(0, photo?.likeCount ?? 0);
}

export function commentCountOf(photo: EngagementFacts | null | undefined): number {
  return Math.max(0, photo?.commentCount ?? 0);
}

/**
 * How a like count reads under a photo.
 *
 * Nothing at all at zero, rather than "0 likes". A gallery of a party where
 * every photo is labelled with a zero is a gallery that looks like it failed.
 */
export function likeLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 like' : `${count} likes`;
}

export function commentLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 comment' : `${count} comments`;
}
