import { defineFunction } from '@aws-amplify/backend';

/**
 * Creates or renames one moment on an event.
 *
 * The Moment model grants no create and no update, and this is why. `eventOwner`
 * is a client-written field, so a host calling the generated createMoment could
 * stamp their own owner id onto a row pointing at somebody else's `eventId` and
 * inject a labelled section into a stranger's gallery. This function reads the
 * event first and compares its stored owner to the caller, the same way
 * updateEventSettings does.
 *
 * Data resolver → data stack, like the other model-adjacent functions.
 */
export const saveMoment = defineFunction({
  name: 'save-moment',
  resourceGroupName: 'data',
});
