import { defineFunction } from '@aws-amplify/backend';

/**
 * Approve, reject, publish and unpublish — and the Go Live switch.
 *
 * In the data group for the same reason as the rest of the Pro path: it is an
 * AppSync handler reading data tables, and a storage-stack function granted
 * from data closes a cycle that synthesis does not detect.
 */
export const decideProPhoto = defineFunction({
  name: 'decide-pro-photo',
  resourceGroupName: 'data',
  memoryMB: 256,
  timeoutSeconds: 20,
});
