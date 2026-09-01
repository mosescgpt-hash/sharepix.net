import { defineFunction } from '@aws-amplify/backend';

/**
 * Creates an event, server-side.
 *
 * Events used to be created by a direct client-side model write, which meant
 * the browser chose the plan, the photo and video limits, the expiry dates and
 * `paid` — and `paid` defaulted to true. Anyone who could sign in could mint a
 * fully-active unlimited event for nothing by sending the create mutation
 * without going near the checkout. The UI was the only thing stopping them.
 *
 * Now the request supplies a name, a date, a place and a plan. Everything that
 * costs money is derived here from server state: limits and dates from the plan
 * table, ownership from the caller's token, and activation from either a live
 * Corporate subscription or a discount code read out of the code table. The
 * rules themselves live in ./newEvent, where they are tested.
 */
export const createEvent = defineFunction({
  name: 'create-event',
  // Data resolver (custom mutation), so keep it in the data stack alongside the
  // other resolver functions to avoid cross-stack circular dependencies.
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
