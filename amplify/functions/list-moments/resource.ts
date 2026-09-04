import { defineFunction } from '@aws-amplify/backend';

/**
 * Returns one event's moments.
 *
 * Exists for the same reason listEventPhotos and listGuestBookEntries do:
 * without it the Moment model would have to grant guests broad list access,
 * which would let anyone enumerate the structure of every event on the
 * platform — names, dates and running order included.
 *
 * Unlike those two there is nothing to hide here. A moment is a label the host
 * printed on a card and put on a table; every guest at the event can already
 * read it. So this returns the whole list, and the scoping to one event is the
 * entire point.
 */
export const listMoments = defineFunction({
  name: 'list-moments',
  resourceGroupName: 'data',
});
