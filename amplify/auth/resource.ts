import { defineAuth } from '@aws-amplify/backend';

/**
 * Host sign-in via email (Gen 2 standard).
 * Guests never sign in — they get access through the identity pool's
 * unauthenticated role, which the data and storage rules grant below.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
  },
  groups: ['ADMINS'],
});
