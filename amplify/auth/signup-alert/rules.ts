/**
 * The decisions the signup alert makes, kept pure so they are tested directly.
 */

/** Accounts after which the alerts stop, unless SIGNUP_ALERT_LIMIT says otherwise. */
export const DEFAULT_SIGNUP_ALERT_LIMIT = 100;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Where the alert goes: SIGNUP_ALERT_TO, else REPORT_TO_ADDRESS.
 *
 * Env vars rather than the AppSetting the monthly report reads, because this
 * function lives in the auth stack and the settings table lives in the data
 * stack, which already depends on auth — reading it from here is a cycle.
 */
export function signupAlertRecipient(env: Record<string, string | undefined>): string | null {
  for (const value of [env.SIGNUP_ALERT_TO, env.REPORT_TO_ADDRESS]) {
    const address = value?.trim() ?? '';
    if (EMAIL.test(address)) return address;
  }
  return null;
}

/**
 * The account count at which alerts stop. `0` turns them off entirely; unset
 * or unreadable falls back to the default rather than to "forever".
 */
export function signupAlertLimit(raw: string | undefined): number {
  const trimmed = raw?.trim() ?? '';
  if (trimmed === '') return DEFAULT_SIGNUP_ALERT_LIMIT;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_SIGNUP_ALERT_LIMIT;
}

/**
 * Whether this signup gets an email.
 *
 * Only a real signup counts: Cognito fires the same trigger when someone
 * confirms a password reset. `accounts` is the pool's estimated user count
 * (which already includes this one), or null when it could not be read — in
 * which case we send, since a missed early signup is the thing this exists to
 * prevent and a stray extra email costs nothing.
 */
export function shouldSendSignupAlert(input: {
  triggerSource: string;
  accounts: number | null;
  limit: number;
}): boolean {
  if (input.triggerSource !== 'PostConfirmation_ConfirmSignUp') return false;
  if (input.limit === 0) return false;
  if (input.accounts === null) return true;
  return input.accounts <= input.limit;
}

/** Subject and plain-text body for the alert. */
export function buildSignupAlert(input: {
  email: string;
  accounts: number | null;
  limit: number;
  at: Date;
}): { subject: string; text: string } {
  const isLast = input.accounts !== null && input.accounts >= input.limit;
  const count = input.accounts === null ? '' : ` (account #${input.accounts})`;
  const lines = [
    `${input.email} just created a SharePix account${count}.`,
    '',
    `Confirmed: ${input.at.toUTCString()}`,
    '',
    isLast
      ? `This is the last of these emails: SharePix now has ${input.limit} or more accounts. ` +
        'Raise SIGNUP_ALERT_LIMIT on the Amplify app and redeploy to keep getting them.'
      : `These emails stop automatically once SharePix has ${input.limit} accounts ` +
        '(SIGNUP_ALERT_LIMIT on the Amplify app; 0 turns them off now).',
  ];
  return {
    // The address is in the body, not the subject, so a preview on a lock
    // screen does not show a customer's email to anyone nearby.
    subject: isLast ? 'New SharePix signup (last alert)' : 'New SharePix signup',
    text: lines.join('\n'),
  };
}
