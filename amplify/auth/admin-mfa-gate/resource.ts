import { defineFunction } from '@aws-amplify/backend';

/**
 * Cognito pre-token-generation trigger: admin powers require an
 * authenticator app. See handler.ts.
 */
export const adminMfaGate = defineFunction({
  name: 'admin-mfa-gate',
  // A Cognito trigger lives with the user pool, or the pool and the function
  // would each depend on the other across stacks.
  resourceGroupName: 'auth',
  timeoutSeconds: 5,
});
