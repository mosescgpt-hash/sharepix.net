import {
  SIGNUP_ALERT_ENABLED_KEY,
  SIGNUP_ALERT_RECIPIENT_KEY,
  buildSignupAlert,
  settingTableParameterName,
  signupAlertTarget,
} from '../amplify/auth/signup-alert/rules';
import { readSource } from './sourceGuards';

const SIGNUP = 'PostConfirmation_ConfirmSignUp';

describe('signup alert', () => {
  it('emails the saved address only when the box is ticked', () => {
    const on = { triggerSource: SIGNUP, enabled: 'true', recipient: ' me@example.com ' };
    expect(signupAlertTarget(on)).toBe('me@example.com');
    expect(signupAlertTarget({ ...on, enabled: 'false' })).toBeNull();
    // Never saved means off.
    expect(signupAlertTarget({ ...on, enabled: '' })).toBeNull();
    expect(signupAlertTarget({ ...on, recipient: '' })).toBeNull();
    expect(signupAlertTarget({ ...on, recipient: 'not-an-address' })).toBeNull();
  });

  it('ignores password-reset confirmations, which fire the same trigger', () => {
    expect(
      signupAlertTarget({
        triggerSource: 'PostConfirmation_ConfirmForgotPassword',
        enabled: 'true',
        recipient: 'me@example.com',
      }),
    ).toBeNull();
  });

  it('reads the same settings the dashboard writes', () => {
    const api = readSource('lib/api.ts');
    expect(api).toContain(`signupAlertEnabled: '${SIGNUP_ALERT_ENABLED_KEY}'`);
    expect(api).toContain(`signupAlertRecipient: '${SIGNUP_ALERT_RECIPIENT_KEY}'`);
  });

  it('keys the table lookup by user pool, so branches never share settings', () => {
    expect(settingTableParameterName('us-east-1_abc')).toBe(
      '/sharepix/signup-alert/us-east-1_abc/setting-table',
    );
    const backend = readSource('amplify/backend.ts');
    expect(backend).toContain('parameterName: settingTableParameterName(userPool.userPoolId)');
    expect(backend).toContain("'parameter/sharepix/signup-alert/*'");
  });

  it('keeps the customer address out of the subject', () => {
    const alert = buildSignupAlert({
      email: 'host@example.com',
      accounts: 7,
      at: new Date('2026-10-07T12:00:00Z'),
      appUrl: 'https://www.sharepix.net',
    });
    expect(alert.subject).not.toContain('host@example.com');
    expect(alert.text).toContain('host@example.com');
    expect(alert.text).toContain('about 7 accounts');
    expect(alert.text).toContain('https://www.sharepix.net/global-admin');
  });

  it('has its controls on the dashboard', () => {
    const page = readSource('pages/global-admin.tsx');
    expect(page).toContain('Email me about new signups');
    expect(page).toContain('aria-label="Signup alert recipient"');
    expect(page).toContain('handleSaveSignupAlerts()');
  });
});
