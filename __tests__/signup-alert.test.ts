import {
  DEFAULT_SIGNUP_ALERT_LIMIT,
  buildSignupAlert,
  shouldSendSignupAlert,
  signupAlertLimit,
  signupAlertRecipient,
} from '../amplify/auth/signup-alert/rules';

const SIGNUP = 'PostConfirmation_ConfirmSignUp';

describe('signup alert', () => {
  it('sends for real signups up to and including the limit', () => {
    expect(shouldSendSignupAlert({ triggerSource: SIGNUP, accounts: 1, limit: 100 })).toBe(true);
    expect(shouldSendSignupAlert({ triggerSource: SIGNUP, accounts: 100, limit: 100 })).toBe(true);
    expect(shouldSendSignupAlert({ triggerSource: SIGNUP, accounts: 101, limit: 100 })).toBe(false);
  });

  it('ignores password-reset confirmations, which fire the same trigger', () => {
    expect(
      shouldSendSignupAlert({
        triggerSource: 'PostConfirmation_ConfirmForgotPassword',
        accounts: 1,
        limit: 100,
      }),
    ).toBe(false);
  });

  it('sends when the count is unreadable, and never when the limit is 0', () => {
    expect(shouldSendSignupAlert({ triggerSource: SIGNUP, accounts: null, limit: 100 })).toBe(true);
    expect(shouldSendSignupAlert({ triggerSource: SIGNUP, accounts: null, limit: 0 })).toBe(false);
  });

  it('reads the limit, falling back to the default rather than to forever', () => {
    expect(signupAlertLimit(undefined)).toBe(DEFAULT_SIGNUP_ALERT_LIMIT);
    expect(signupAlertLimit('')).toBe(DEFAULT_SIGNUP_ALERT_LIMIT);
    expect(signupAlertLimit('lots')).toBe(DEFAULT_SIGNUP_ALERT_LIMIT);
    expect(signupAlertLimit('-5')).toBe(DEFAULT_SIGNUP_ALERT_LIMIT);
    expect(signupAlertLimit('250')).toBe(250);
    expect(signupAlertLimit('0')).toBe(0);
  });

  it('prefers SIGNUP_ALERT_TO, falls back to REPORT_TO_ADDRESS, else nobody', () => {
    expect(
      signupAlertRecipient({ SIGNUP_ALERT_TO: 'a@x.com', REPORT_TO_ADDRESS: 'b@x.com' }),
    ).toBe('a@x.com');
    expect(signupAlertRecipient({ SIGNUP_ALERT_TO: '', REPORT_TO_ADDRESS: 'b@x.com' })).toBe(
      'b@x.com',
    );
    expect(signupAlertRecipient({})).toBeNull();
    expect(signupAlertRecipient({ SIGNUP_ALERT_TO: 'not-an-address' })).toBeNull();
  });

  it('keeps the customer address out of the subject and flags the last alert', () => {
    const at = new Date('2026-10-07T12:00:00Z');
    const normal = buildSignupAlert({ email: 'host@example.com', accounts: 7, limit: 100, at });
    expect(normal.subject).not.toContain('host@example.com');
    expect(normal.text).toContain('host@example.com');
    expect(normal.text).toContain('account #7');

    const last = buildSignupAlert({ email: 'host@example.com', accounts: 100, limit: 100, at });
    expect(last.subject).toContain('last alert');
    expect(last.text).toContain('SIGNUP_ALERT_LIMIT');
  });
});
