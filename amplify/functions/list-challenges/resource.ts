import { defineFunction } from '@aws-amplify/backend';

/** Photo challenges: one event's list, for guests and the host. Read-only. */
export const listChallenges = defineFunction({
  name: 'list-challenges',
  resourceGroupName: 'data',
});
