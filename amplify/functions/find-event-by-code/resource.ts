import { defineFunction } from '@aws-amplify/backend';

/**
 * Turns an event code a guest typed into the event it belongs to.
 *
 * A Lambda rather than a model query, and that is the whole point: this is the
 * one endpoint on SharePix that takes a guess and says whether it was right.
 * Putting it behind a function gives somewhere to throttle, somewhere to log,
 * and a return shape that reveals one event rather than a list.
 */
export const findEventByCode = defineFunction({
  name: 'find-event-by-code',
  resourceGroupName: 'data',
  memoryMB: 256,
  timeoutSeconds: 15,
});
