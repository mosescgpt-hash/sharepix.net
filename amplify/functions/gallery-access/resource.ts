import { defineFunction } from '@aws-amplify/backend';

/**
 * The gallery PIN: guests enter it (verifyGalleryPin) and the host sets,
 * clears or checks it (manageGalleryPin). One function for both so the hashing,
 * the token key and the rate limits live in one place. Data resolver → data
 * stack, like the other query/mutation functions.
 */
export const galleryAccess = defineFunction({
  name: 'gallery-access',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
});
