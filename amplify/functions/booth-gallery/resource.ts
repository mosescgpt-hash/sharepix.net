import { defineFunction } from '@aws-amplify/backend';

/**
 * Booth mode, step 4 (docs/booth-mode.md): one attendee's private gallery,
 * opened by the secret key emailed to them. Returns signed preview and
 * full-resolution download links for their approved photos only.
 */
export const boothGallery = defineFunction({
  name: 'booth-gallery',
  resourceGroupName: 'data',
  timeoutSeconds: 20,
});
