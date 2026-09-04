/**
 * Which guest book entries a guest may see.
 *
 * A copy of `entryVisibleToGuests` from `lib/guestBook.ts` — Amplify functions
 * bundle separately and cannot import from the app. Kept to just this one rule
 * because it is all the list query needs, and `__tests__/guest-book.test.ts`
 * covers the same behaviour on the app's copy.
 */

export interface GuestBookEntryFacts {
  moderationStatus?: string | null;
  hidden?: boolean | null;
}

/**
 * `hidden` is the host's explicit decision and beats everything — a host who
 * hides a note has said so, and no screening verdict should second-guess them.
 * A missing status reads as visible so a screening change never blanks an album
 * that was already published, which is the same call the photo path makes.
 */
export function entryVisibleToGuests(
  entry: GuestBookEntryFacts | null | undefined,
): boolean {
  if (!entry) return false;
  if (entry.hidden === true) return false;
  return entry.moderationStatus !== 'flagged';
}
