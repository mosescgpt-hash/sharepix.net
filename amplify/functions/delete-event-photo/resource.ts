import { defineFunction } from '@aws-amplify/backend';

/**
 * Deletes a photo's S3 objects and its record after verifying the caller owns
 * the event (or is a global admin). S3 delete permission is granted only to
 * this function — never broadly to every signed-in user — so one host can no
 * longer reach another event's files.
 */
export const deleteEventPhoto = defineFunction({
  name: 'delete-event-photo',
  // This is a data resolver that also reads/writes the data tables, so it must
  // live in the data stack to avoid a circular dependency between stacks.
  resourceGroupName: 'data',
});
