import { defineFunction } from '@aws-amplify/backend';

/**
 * Deletes an event's row for its host. The Event model no longer grants its
 * owner `delete`, so this is the only way a host removes an event — and it is
 * where a closed event is refused. Photos are removed first by the client,
 * one at a time, through deleteEventPhoto, exactly as before.
 */
export const deleteEvent = defineFunction({
  name: 'delete-event',
  resourceGroupName: 'data',
});
