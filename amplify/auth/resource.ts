import { defineAuth } from '@aws-amplify/backend';
import { adminMfaGate } from './admin-mfa-gate/resource';

/**
 * Host sign-in via email (Gen 2 standard).
 * Guests never sign in — they get access through the identity pool's
 * unauthenticated role, which the data and storage rules grant below.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  // NB: do NOT add `userAttributes` here. Cognito refuses to change a user
  // pool's schema after the pool exists ("User pool attributes cannot be
  // changed after a user pool has been created"), so declaring a new standard
  // attribute fails the deploy and rolls back. The host display name is stored
  // in the HostProfile data model instead — see amplify/data/resource.ts.
  multifactor: {
    mode: 'OPTIONAL',
    totp: true,
  },
  groups: ['ADMINS'],
  // Admin powers require an authenticator app: an ADMINS member without TOTP
  // gets tokens without the ADMINS group. MFA stays optional for hosts.
  triggers: {
    preTokenGeneration: adminMfaGate,
  },
});
