/**
 * The decisions the signup alert makes, kept pure so they are tested directly.
 *
 * Both settings are AppSetting rows a global admin edits on /global-admin.
 * The keys here must match SETTING_KEYS in lib/api.ts; a test checks.
 */

export const SIGNUP_ALERT_ENABLED_KEY = 'signup-alert-enabled';
export const SIGNUP_ALERT_RECIPIENT_KEY = 'signup-alert-recipient';

/**
 * Where the trigger finds the AppSetting table's name, keyed by user pool.
 *
 * The trigger lives in the auth stack and the table in the data stack, which
 * already depends on auth — so the table name cannot be passed in as an
 * environment variable without a cycle. The data stack writes it to this SSM
 * parameter instead, and the trigger looks it up by the pool id it is handed
 * on every invocation. Keyed by pool so sandboxes and branches sharing an
 * account never read each other's settings.
 */
export function settingTableParameterName(userPoolId: string): string {
  return `/sharepix/signup-alert/${userPoolId}/setting-table`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailAddress(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Who to email for this confirmation, or null to send nothing.
 *
 * Only a real signup counts: Cognito fires the same trigger when someone
 * confirms a password reset. Off unless the box is ticked, and nothing without
 * a usable address.
 */
export function signupAlertTarget(input: {
  triggerSource: string;
  enabled: string;
  recipient: string;
}): string | null {
  if (input.triggerSource !== 'PostConfirmation_ConfirmSignUp') return null;
  if (input.enabled.trim() !== 'true') return null;
  const to = input.recipient.trim();
  return isEmailAddress(to) ? to : null;
}

/** Subject and plain-text body for the alert. */
export function buildSignupAlert(input: {
  email: string;
  accounts: number | null;
  at: Date;
  appUrl: string;
}): { subject: string; text: string } {
  const count = input.accounts === null ? '' : ` (about ${input.accounts} accounts in total)`;
  return {
    // The address is in the body, not the subject, so a preview on a lock
    // screen does not show a customer's email to anyone nearby.
    subject: 'New SharePix signup',
    text: [
      `${input.email} just created a SharePix account${count}.`,
      '',
      `Confirmed: ${input.at.toUTCString()}`,
      '',
      `To stop these emails or change where they go, untick "Email me about new signups" at ${input.appUrl}/global-admin.`,
    ].join('\n'),
  };
}
