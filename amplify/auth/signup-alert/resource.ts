import { defineFunction } from '@aws-amplify/backend';

/**
 * Cognito post-confirmation trigger: emails the operator when a new host
 * account is confirmed, until the site has enough accounts that one email per
 * signup stops being useful. See handler.ts and rules.ts.
 */
export const signupAlert = defineFunction({
  name: 'signup-alert',
  // A Cognito trigger lives with the user pool, or the pool and the function
  // would each depend on the other across stacks.
  resourceGroupName: 'auth',
  timeoutSeconds: 10,
});
