import { defineFunction } from '@aws-amplify/backend';

/**
 * Creates a photo record on behalf of a guest or host. Runs server-side so it
 * can stamp `eventOwner` from the event (clients can't spoof ownership or
 * self-approve) and enforce the event's photo limit atomically.
 */
export const createEventPhoto = defineFunction({
  name: 'create-event-photo',
});
