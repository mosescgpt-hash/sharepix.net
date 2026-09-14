import { defineFunction } from '@aws-amplify/backend';

/**
 * Creates and changes the one row that authorizes a photographer.
 *
 * Exists because EventPhotographer grants create and update to nobody: if a
 * photographer could write that row they could write `status: accepted` for
 * any event id they could guess. Every state change goes through here, where
 * who is asking is checked against what they are asking for.
 */
export const connectPhotographer = defineFunction({
  name: 'connect-photographer',
  resourceGroupName: 'data',
  memoryMB: 256,
  timeoutSeconds: 20,
});
