import { defineFunction } from '@aws-amplify/backend';

/**
 * Re-stamps a photographer's existing previews after they change their
 * watermark, from the unmarked copies kept beside each preview. Invoked
 * asynchronously by refresh-pro-watermarks, never by a browser.
 */
export const restampProPhotos = defineFunction({
  name: 'restamp-pro-photos',
  resourceGroupName: 'data',
  timeoutSeconds: 900,
  memoryMB: 1536,
});
