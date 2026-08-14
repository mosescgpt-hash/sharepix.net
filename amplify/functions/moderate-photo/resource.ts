import { defineFunction } from '@aws-amplify/backend';

/**
 * Acts on a flagged photo from a review link. Callable without signing in — the
 * review token is the authorization — so the function re-validates the token on
 * every call rather than trusting the caller.
 */
export const moderatePhoto = defineFunction({
  name: 'moderate-photo',
  resourceGroupName: 'data',
  timeoutSeconds: 20,
});
