import { defineFunction } from '@aws-amplify/backend';

/**
 * Global-admin user actions: reset a user's password (sends them a reset code)
 * or enable/disable their account. Cognito admin permissions and the user pool
 * id are granted in backend.ts.
 */
export const adminUserActions = defineFunction({
  name: 'admin-user-actions',
  resourceGroupName: 'data',
});
