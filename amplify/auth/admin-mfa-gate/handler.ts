import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PreTokenGenerationTriggerHandler } from 'aws-lambda';
import { groupsForToken, hasTotp, ADMIN_GROUP } from './gate';

const cognito = new CognitoIdentityProviderClient({});

/**
 * Admin powers require an authenticator app.
 *
 * Cognito's MFA setting is pool-wide, and switching it to required would force
 * every host at every wedding to install an authenticator. So the requirement
 * is applied where the power is granted instead: when a token is issued, an
 * ADMINS member without TOTP set up gets a token without the ADMINS group.
 * Everything admin-only — the AppSync group rules, the storage rules, the
 * admin pages — reads that group, so this one check covers all of it.
 *
 * Because an admin with TOTP set up is always challenged for a code at sign-in
 * (Cognito asks whenever a user has MFA enabled), "carries ADMINS" means
 * "signed in with a password and a current code".
 *
 * Never throws: a failing trigger would fail every sign-in on the site. Any
 * error withholds the admin group and lets sign-in through.
 */
export const handler: PreTokenGenerationTriggerHandler = async (event) => {
  const groups = event.request.groupConfiguration?.groupsToOverride ?? [];
  if (!groups.includes(ADMIN_GROUP)) return event;

  let mfaOk: boolean | null = null;
  try {
    const user = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: event.userPoolId, Username: event.userName }),
    );
    mfaOk = hasTotp(user.UserMFASettingList);
  } catch (error) {
    console.error('Admin MFA check failed; withholding admin group', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const override = groupsForToken(groups, mfaOk);
  if (override) {
    event.response.claimsOverrideDetails = {
      ...(event.response.claimsOverrideDetails ?? {}),
      groupOverrideDetails: { groupsToOverride: override },
    };
  }
  return event;
};
