import { defineFunction } from '@aws-amplify/backend';

/**
 * Returns a single event's approved photos for the public gallery, so the
 * Photo model never has to grant guests broad list access (which would let
 * anyone enumerate photos across every event). Data resolver → data stack.
 */
export const listEventPhotos = defineFunction({
  name: 'list-event-photos',
  resourceGroupName: 'data',
});
