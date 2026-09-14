import { defineFunction } from '@aws-amplify/backend';

/**
 * Issues one upload slot to an authorized photographer.
 *
 * Small and fast: it checks a connection row and signs a URL. The work happens
 * in process-pro-photo, which is sized very differently.
 */
export const proUpload = defineFunction({
  name: 'pro-upload',
  // 'data', not 'storage': this is an AppSync handler that also reads the
  // EventPhotographer table, and a function in the storage stack granted from
  // the data stack closes a cycle across the two. media-url, delete-event-photo
  // and print-fulfill all sit in data for the same reason — bucket grants flow
  // that way, table grants do not flow back.
  resourceGroupName: 'data',
  memoryMB: 256,
  timeoutSeconds: 20,
});
