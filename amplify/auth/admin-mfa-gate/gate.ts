/**
 * The decision the trigger makes, kept pure so it is tested directly.
 */

export const ADMIN_GROUP = 'ADMINS';

/**
 * The groups a token should carry.
 *
 * Unchanged for everyone who is not an admin, and for an admin with an
 * authenticator app (TOTP) set up. An admin WITHOUT one keeps every other
 * group but loses ADMINS from the token, so every admin-only rule in the
 * schema and every admin check in the app refuses them. They can still sign
 * in, use the site as a host, and set up an authenticator on
 * /account-security; their next sign-in carries ADMINS again.
 *
 * `mfaOk === null` means the check itself failed. Admin powers fail CLOSED on
 * that — the group is withheld — while sign-in still succeeds.
 */
export function groupsForToken(groups: readonly string[], mfaOk: boolean | null): string[] | null {
  if (!groups.includes(ADMIN_GROUP)) return null; // no override
  if (mfaOk === true) return null;
  return groups.filter((g) => g !== ADMIN_GROUP);
}

/** Whether a Cognito user's MFA settings include an authenticator app. */
export function hasTotp(settings: readonly string[] | null | undefined): boolean {
  return (settings ?? []).includes('SOFTWARE_TOKEN_MFA');
}
