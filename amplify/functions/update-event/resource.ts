import { defineFunction } from '@aws-amplify/backend';

/**
 * Changes an event's host-editable settings — its name, date, place, screening
 * mode, alert address, and the video/download/closed toggles.
 *
 * The Event model grants owners no `update`, because the owner rule covered the
 * whole row: a host could send `paid: true` and activate an event they hadn't
 * paid for, raise their own `photoLimit`, reset the counters createEventPhoto
 * maintains, or push out the dates the retention lifecycle is measured from.
 * Deriving all of that at creation is worth nothing if it can be overwritten a
 * second later.
 *
 * The allow-list in ./settings is the whole surface a host can write, and it is
 * tested there. Admins keep model-level update — that is how the global-admin
 * dashboard grants extra capacity and moves an upload window.
 */
export const updateEvent = defineFunction({
  name: 'update-event',
  // Data resolver (custom mutation), so keep it in the data stack alongside the
  // other resolver functions to avoid cross-stack circular dependencies.
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
