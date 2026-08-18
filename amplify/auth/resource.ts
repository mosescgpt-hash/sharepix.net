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
  // A host can set a display name on their account (Cognito's standard `name`
  // attribute). Declaring it here is what makes it writable by the account
  // page — an undeclared standard attribute is read-only to the app client.
  // Optional: with none set, the app falls back to the email prefix as before.
  userAttributes: {
    fullname: {
      mutable: true,
      required: false,
    },
  },
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
  },
  groups: ['ADMINS'],
});
