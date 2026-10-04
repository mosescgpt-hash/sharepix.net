import { defineFunction } from '@aws-amplify/backend';

/** Photo challenges: the host's writes (save, delete, settings). */
export const saveChallenge = defineFunction({
  name: 'save-challenge',
  resourceGroupName: 'data',
});
