import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { PostConfirmationTriggerHandler } from 'aws-lambda';
import {
  SIGNUP_ALERT_ENABLED_KEY,
  SIGNUP_ALERT_RECIPIENT_KEY,
  buildSignupAlert,
  settingTableParameterName,
  signupAlertTarget,
} from './rules';

const cognito = new CognitoIdentityProviderClient({});
const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});
const ssm = new SSMClient({});

/** One AppSetting value, '' when the row does not exist. */
async function readSetting(table: string, key: string): Promise<string> {
  const found = await dynamo.send(
    new GetItemCommand({ TableName: table, Key: { id: { S: key } } }),
  );
  return (found.Item?.value?.S ?? '').trim();
}

/** The pool's estimated user count, or null if it could not be read. */
async function accountCount(userPoolId: string): Promise<number | null> {
  try {
    const res = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }));
    const n = res.UserPool?.EstimatedNumberOfUsers;
    return typeof n === 'number' ? n : null;
  } catch {
    return null;
  }
}

/**
 * Emails the operator when a host confirms a new account — switched on and
 * pointed at an inbox from /global-admin ("Signup alerts"), off by default.
 *
 * Never throws: a failing post-confirmation trigger fails the confirmation, so
 * the new host would be told their signup did not work.
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  try {
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp') return event;
    const from = process.env.ALERT_FROM_ADDRESS?.trim();
    if (!from) return event;

    const param = await ssm.send(
      new GetParameterCommand({ Name: settingTableParameterName(event.userPoolId) }),
    );
    const table = param.Parameter?.Value;
    if (!table) return event;

    const [enabled, recipient] = await Promise.all([
      readSetting(table, SIGNUP_ALERT_ENABLED_KEY),
      readSetting(table, SIGNUP_ALERT_RECIPIENT_KEY),
    ]);
    const to = signupAlertTarget({ triggerSource: event.triggerSource, enabled, recipient });
    if (!to) return event;

    const email = event.request.userAttributes?.email ?? '(no email on the account)';
    const { subject, text } = buildSignupAlert({
      email,
      accounts: await accountCount(event.userPoolId),
      at: new Date(),
      appUrl: process.env.APP_URL ?? 'https://www.sharepix.net',
    });
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
    console.log('Signup alert sent');
  } catch (error) {
    console.error('Signup alert failed; the signup itself is unaffected', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return event;
};
