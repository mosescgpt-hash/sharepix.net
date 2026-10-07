import { defineFunction } from '@aws-amplify/backend';

/**
 * Global-admin only: the account email for each Cognito sub asked about, so
 * the Free trials tab can show who each trial belongs to. Read-only
 * (`cognito-idp:ListUsers`), granted in backend.ts.
 */
export const accountEmails = defineFunction({
  name: 'account-emails',
  resourceGroupName: 'data',
  // Pages through the pool, 60 accounts a call.
  timeoutSeconds: 30,
});
