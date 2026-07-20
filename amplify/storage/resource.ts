import { defineStorage } from '@aws-amplify/backend';

/**
 * Photo storage. Guests and hosts can upload and view photos under events/.
 * Deletes are NOT granted here: any signed-in user would otherwise be able to
 * remove another event's files. Deletion runs through the `deleteEventPhoto`
 * function, which checks event ownership before touching S3.
 */
export const storage = defineStorage({
  name: 'sharepixPhotos',
  access: (allow) => ({
    'events/*': [
      allow.guest.to(['read', 'write']),
      allow.authenticated.to(['read', 'write']),
      // Users in the ADMINS group use the admin IAM role, which otherwise
      // wouldn't inherit the authenticated role's storage access — so admins
      // couldn't load photos. Grant it explicitly.
      allow.groups(['ADMINS']).to(['read', 'write']),
    ],
  }),
});
