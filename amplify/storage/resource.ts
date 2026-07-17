import { defineStorage } from '@aws-amplify/backend';

/**
 * Photo storage. Guests can upload and view photos under events/;
 * signed-in hosts can also delete.
 */
export const storage = defineStorage({
  name: 'sharepixPhotos',
  access: (allow) => ({
    'events/*': [
      allow.guest.to(['read', 'write']),
      allow.authenticated.to(['read', 'write', 'delete']),
    ],
  }),
});
