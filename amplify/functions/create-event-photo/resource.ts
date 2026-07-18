import { defineFunction } from '@aws-amplify/backend';

/**
 * Creates a photo record on behalf of a guest or host. Runs server-side so it
 * can stamp `eventOwner` from the event (clients can't spoof ownership or
 * self-approve) and enforce the event's photo limit atomically.
 */
export const createEventPhoto = defineFunction({
  name: 'create-event-photo',
  // This is a data resolver that also reads/writes the data tables, so it must
  // live in the data stack to avoid a circular dependency between stacks.
  resourceGroupName: 'data',
});
