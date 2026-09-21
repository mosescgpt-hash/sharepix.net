import { defineStorage } from '@aws-amplify/backend';
import { sanitizeUpload } from '../functions/sanitize-upload/resource';

/**
 * Photo storage. Guests and hosts can upload and view photos under events/.
 * Deletes are NOT granted here: any signed-in user would otherwise be able to
 * remove another event's files. Deletion runs through the `deleteEventPhoto`
 * function, which checks event ownership before touching S3.
 *
 * Every uploaded object triggers `sanitize-upload`, which validates the real
 * bytes server-side and deletes disguised or oversize files.
 */
export const storage = defineStorage({
  name: 'sharepixPhotos',
  triggers: {
    onUpload: sanitizeUpload,
  },
  access: (allow) => ({
    'events/*': [
      allow.guest.to(['read', 'write']),
      allow.authenticated.to(['read', 'write']),
      // Users in the ADMINS group use the admin IAM role, which otherwise
      // wouldn't inherit the authenticated role's storage access — so admins
      // couldn't load photos. Grant it explicitly.
      allow.groups(['ADMINS']).to(['read', 'write']),
    ],
    // The homepage "try an upload" demo. Write and nothing else, for anybody.
    //
    // **No read, for any principal, including admins.** That is not an
    // oversight to tidy up later — it is the entire safety model. A visitor's
    // demo photo is displayed to them from their own device, never fetched
    // back, so "nobody else can see it" is a property of there being nowhere to
    // see it from rather than a rule somebody has to keep enforcing. Granting
    // read here, even to one role, would quietly turn an unauthenticated upload
    // box on the front page into a place a stranger's photo can be looked at.
    //
    // No delete either: `demo-cleanup` holds that as a scoped IAM policy in
    // backend.ts, so the "nobody gets S3 delete" rule in the README still holds
    // for every human principal.
    'demo/*': [allow.guest.to(['write']), allow.authenticated.to(['write'])],
  }),
});
