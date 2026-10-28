import { defineFunction } from '@aws-amplify/backend';

/**
 * The guest link key: the host reads it (to put it in QR codes and links) and
 * replaces it (manageGalleryLink). Data resolver → data stack, like the other
 * query/mutation functions.
 */
export const galleryAccess = defineFunction({
  name: 'gallery-access',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
});
