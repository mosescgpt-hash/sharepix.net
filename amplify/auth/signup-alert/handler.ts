import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
  buildSignupAlert,
  shouldSendSignupAlert,
  signupAlertLimit,
  signupAlertRecipient,
} from './rules';

const cognito = new CognitoIdentityProviderClient({});
const ses = new SESv2Client({});

/** The pool's estimated user count, or null if it could not be read. */
async function accountCount(userPoolId: string): Promise<number | null> {
  try {
    const res = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }));
    const n = res.UserPool?.EstimatedNumberOfUsers;
    return typeof n === 'number' ? n : null;
  } catch (error) {
    console.error('Signup alert: could not read the account count', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Emails the operator when a host confirms a new account — a temporary,
 * early-days signal that switches itself off once the site has
 * SIGNUP_ALERT_LIMIT accounts (100 by default).
 *
 * Ships off: with no recipient (SIGNUP_ALERT_TO or REPORT_TO_ADDRESS) or no
 * ALERT_FROM_ADDRESS it does nothing.
 *
 * Never throws: a failing post-confirmation trigger fails the confirmation, so
 * the new host would be told their signup did not work.
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  try {
    const from = process.env.ALERT_FROM_ADDRESS?.trim();
    const to = signupAlertRecipient(process.env);
    if (!from || !to) return event;
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;

    const limit = signupAlertLimit(process.env.SIGNUP_ALERT_LIMIT);
    if (limit === 0) return event;

    const accounts = await accountCount(event.userPoolId);
    if (!shouldSendSignupAlert({ triggerSource: event.triggerSource, accounts, limit })) {
      return event;
    }

    const email = event.request.userAttributes?.email ?? '(no email on the account)';
    const { subject, text } = buildSignupAlert({ email, accounts, limit, at: new Date() });
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
    console.log('Signup alert sent', { accounts, limit });
  } catch (error) {
    console.error('Signup alert failed; the signup itself is unaffected', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return event;
};
