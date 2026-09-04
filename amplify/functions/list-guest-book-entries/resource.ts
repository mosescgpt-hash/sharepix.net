import { defineFunction } from '@aws-amplify/backend';

/**
 * Returns one event's visible guest book entries.
 *
 * Exists for the same reason listEventPhotos does: without it the
 * GuestBookEntry model would have to grant guests broad list access, which
 * would let anyone enumerate every note left at every event on the platform.
 * The host reads the model directly through owner auth and sees everything,
 * including the entries held for review.
 */
export const listGuestBookEntries = defineFunction({
  name: 'list-guest-book-entries',
  resourceGroupName: 'data',
});
