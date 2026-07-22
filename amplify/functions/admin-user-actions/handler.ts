// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime / bundled at deploy,
// not installed for the backend type-check.
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminResetUserPasswordCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID as string;

type Handler = Schema['manageUser']['functionHandler'];

export const handler: Handler = async (event) => {
  const email = (event.arguments.email ?? '').trim().toLowerCase();
  const action = event.arguments.action;
  if (!email) {
    return { success: false, message: 'Enter the account email.' };
  }

  // Email is an attribute, not the Cognito username, so look up the user first.
  const list = await client.send(
    new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${email.replace(/"/g, '')}"`,
      Limit: 1,
    }),
  );
  const username = list.Users?.[0]?.Username;
  if (!username) {
    return { success: false, message: `No account found for ${email}.` };
  }

  try {
    if (action === 'resetPassword') {
      await client.send(
        new AdminResetUserPasswordCommand({ UserPoolId: USER_POOL_ID, Username: username }),
      );
      return {
        success: true,
        message: `Password reset for ${email}. They'll get an email with a code to set a new password (this also lets them back in if they were locked out).`,
      };
    }
    if (action === 'enable') {
      await client.send(
        new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
      );
      return { success: true, message: `${email}'s account is re-enabled.` };
    }
    if (action === 'disable') {
      await client.send(
        new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }),
      );
      return { success: true, message: `${email}'s account is disabled.` };
    }
    return { success: false, message: 'Unknown action.' };
  } catch (error) {
    return {
      success: false,
      message: `Action failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
