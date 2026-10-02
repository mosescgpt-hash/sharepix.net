import { defineFunction } from '@aws-amplify/backend';

/**
 * Closes or reopens an event for its content: sets the takedown state on the
 * row, moves its media into (or back out of) the admin-only quarantine prefix,
 * removes the R2 copies, and rewrites the Photo rows' keys. Admin-only.
 *
 * Fifteen minutes, the Lambda maximum, because a large event is thousands of
 * objects. The work is idempotent: a run that times out leaves the event
 * marked closed, and pressing Close again finishes the move.
 */
export const eventTakedown = defineFunction({
  name: 'event-takedown',
  resourceGroupName: 'data',
  timeoutSeconds: 900,
  memoryMB: 512,
});
