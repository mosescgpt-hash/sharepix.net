/**
 * The guest book rules, as the Lambda sees them.
 *
 * A byte-for-byte copy of the code in `lib/guestBook.ts`. Amplify functions are
 * bundled separately and cannot import from the app, so the duplication is
 * forced; `__tests__/guest-book-entry.test.ts` fails if the two ever drift,
 * which is the part that actually matters. Edit `lib/guestBook.ts` and re-copy.
 *
 * These are the SERVER's copy, and the only one that is a control. The
 * browser's identical checks are a courtesy to the guest.
 */

/**
 * Plans that include the guest book at no extra cost. Everyone else can buy it
 * as a per-event add-on, the same shape as the live slideshow.
 *
 * Corporate is here because corporate events are premium-like everywhere else
 * in the product (unlimited photos, 1-year retention); leaving it out would
 * make the most expensive plan the only one that has to pay extra.
 */
export const GUEST_BOOK_INCLUDED_TIERS = ['premium', 'corporate'] as const;

/** Longest a guest's signature may be. */
export const MAX_NAME_LENGTH = 60;

/**
 * Longest a note may be. Generous enough for a real message and short enough
 * that the album stays readable and one guest cannot write a novel into a
 * shared page.
 */
export const MAX_MESSAGE_LENGTH = 1000;

/**
 * A hard ceiling on entries per event. This is an abuse bound, not a product
 * limit — no real event reaches it, and an unauthenticated write endpoint needs
 * a number it cannot exceed.
 */
export const MAX_ENTRIES_PER_EVENT = 2000;

export interface GuestBookEventFacts {
  tier?: string | null;
  /** Bought as an add-on. Flipped by the Stripe webhook, never by the client. */
  guestBookEnabled?: boolean | null;
}

/** True when the event's plan includes the guest book without an add-on. */
export function guestBookIncludedInTier(tier?: string | null): boolean {
  if (!tier) return false;
  const id = tier.trim().toLowerCase();
  return (GUEST_BOOK_INCLUDED_TIERS as readonly string[]).includes(id);
}

/**
 * Whether this event has a guest book at all. Included by plan, or bought.
 *
 * Deliberately not "missing means on": unlike video uploads, the guest book did
 * not exist before this feature, so there is no older event whose behaviour a
 * strict default would change.
 */
export function guestBookAvailable(event: GuestBookEventFacts | null | undefined): boolean {
  if (!event) return false;
  return event.guestBookEnabled === true || guestBookIncludedInTier(event.tier);
}

/**
 * Whether the add-on is still worth offering this host. Premium and Corporate
 * already have it, and an event that has bought it must never be sold it twice
 * — the checkout function re-derives this server-side for exactly that reason.
 */
export function guestBookPurchasable(event: GuestBookEventFacts | null | undefined): boolean {
  if (!event) return false;
  if (guestBookIncludedInTier(event.tier)) return false;
  return event.guestBookEnabled !== true;
}

/**
 * Strip characters that have no business in a note and normalise the rest.
 *
 * Control characters are removed rather than escaped: they are invisible, so a
 * guest never typed them on purpose, and they are what gets used to smuggle
 * something past a length check or into a log line. Newlines survive when
 * `allowNewlines` is set, because a note is prose and paragraphs are real.
 *
 * The result is capped by slicing, so a caller that forgets to check the length
 * still cannot store an oversized value.
 */
export function cleanText(
  value: unknown,
  maxLength: number,
  allowNewlines = false,
): string {
  if (typeof value !== 'string') return '';

  // Everything invisible goes, EXCEPT tab and newline. Those two are kept so
  // the collapse below can turn them into a space or a paragraph break -
  // stripping them outright would silently weld words together, turning
  // "Maya\nPatel" into "MayaPatel".
  //
  // C0 is \u0000-\u001F, DEL is \u007F, C1 is \u0080-\u009F. Written as
  // escapes rather than literal bytes so the class survives an edit.
  const stripped = value.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');

  const collapsed = allowNewlines
    ? stripped
        // Runs of spaces and tabs collapse, but line structure survives.
        .replace(/[^\S\n]+/g, ' ')
        // Three or more blank lines is someone padding the page.
        .replace(/\n{3,}/g, '\n\n')
    : stripped.replace(/\s+/g, ' ');

  return collapsed.trim().slice(0, maxLength);
}

const EXPLICIT_LINK = /(?:https?:\/\/|www\.)\S+/i;
const BARE_DOMAIN =
  /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|co|me|xyz|ru|cn|info|biz|shop|link|click|top|site|online)\b/i;

/**
 * Whether a note contains something that looks like a link.
 *
 * Links are the whole spam vector for a public, unauthenticated text form, and
 * they are also the one thing no guest book entry legitimately needs. A note
 * with one is held for the host rather than rejected — a guest sharing a photo
 * album URL with the couple is a real thing, and silently dropping their
 * message would be worse than making the host tap "show".
 */
export function containsLink(text: string): boolean {
  return EXPLICIT_LINK.test(text) || BARE_DOMAIN.test(text);
}

export interface EntryDraft {
  name?: unknown;
  message?: unknown;
  /** Id of a Photo the guest already uploaded to this event, if they attached one. */
  photoId?: unknown;
}

export interface CleanEntry {
  name: string;
  message: string;
  photoId: string | null;
}

export type EntryCheck =
  | { ok: true; entry: CleanEntry }
  | { ok: false; reason: string };

/**
 * Clean and check a submitted entry.
 *
 * A name is always required — it is a *guest* book, and an unsigned note is
 * both less valuable to the couple and harder to moderate. Beyond that a guest
 * needs to have actually said something: either words, or a photo or video
 * message. An entry with a name and nothing else is a no-op that would clutter
 * the album.
 */
export function validateEntry(draft: EntryDraft): EntryCheck {
  const name = cleanText(draft.name, MAX_NAME_LENGTH);
  if (!name) return { ok: false, reason: 'Add your name so they know who this is from.' };

  const message = cleanText(draft.message, MAX_MESSAGE_LENGTH, true);

  const rawPhotoId = typeof draft.photoId === 'string' ? draft.photoId.trim() : '';
  // Shape only. Whether this photo belongs to this event is a database
  // question, answered server-side — a guest could otherwise attach any photo
  // id they can guess and pull it into an event it does not belong to.
  const photoId = rawPhotoId && rawPhotoId.length <= 200 ? rawPhotoId : null;

  if (!message && !photoId) {
    return { ok: false, reason: 'Write a note, or attach a photo or video message.' };
  }

  return { ok: true, entry: { name, message, photoId } };
}

export interface EntryScreening {
  status: 'ok' | 'flagged';
  reasons: string[];
}

/**
 * Screen a note's text.
 *
 * This is a link check, not a content classifier — worth being plain about.
 * Rekognition screens an attached image for explicit content on the way in
 * (createEventPhoto already does that, and an attached photo is an ordinary
 * upload), but nothing here reads the *meaning* of the words. The host's review
 * queue is what catches an unkind note, which is the same bargain the photo
 * side already makes.
 *
 * `allow_all` skips it, matching what that setting already means for photos:
 * the host has said they will take everything as it comes.
 */
export function screenEntryText(
  message: string,
  moderationMode?: string | null,
): EntryScreening {
  if ((moderationMode ?? 'review') === 'allow_all') {
    return { status: 'ok', reasons: [] };
  }
  if (message && containsLink(message)) {
    return { status: 'flagged', reasons: ['link'] };
  }
  return { status: 'ok', reasons: [] };
}

export interface GuestBookEntryFacts {
  moderationStatus?: string | null;
  hidden?: boolean | null;
}

/**
 * Whether guests see an entry in the album.
 *
 * `hidden` is the host's explicit decision and beats everything — a host who
 * hides a note has said so, and no screening verdict should second-guess them.
 * A missing status reads as visible so a screening change never blanks the
 * album, which is the same call the photo path makes.
 */
export function entryVisibleToGuests(
  entry: GuestBookEntryFacts | null | undefined,
): boolean {
  if (!entry) return false;
  if (entry.hidden === true) return false;
  return entry.moderationStatus !== 'flagged';
}

/** Entries the host still needs to look at. */
export function entryNeedsReview(
  entry: GuestBookEntryFacts | null | undefined,
): boolean {
  if (!entry) return false;
  return entry.hidden !== true && entry.moderationStatus === 'flagged';
}
