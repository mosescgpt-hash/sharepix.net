import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import outputs from '../amplify_outputs.json';

async function main() {
  const search = process.argv[2]?.trim().toLowerCase();

  if (!search) {
    throw new Error('Pass the Cognito username or the beginning of the account email.');
  }

  const client = new CognitoIdentityProviderClient({ region: outputs.auth.aws_region });
  const response = await client.send(
    new ListUsersCommand({
      UserPoolId: outputs.auth.user_pool_id,
      Limit: 60,
    }),
  );

  const matches = (response.Users ?? []).filter((user) => {
    const email = user.Attributes?.find((attribute) => attribute.Name === 'email')?.Value;
    return user.Username?.toLowerCase() === search || email?.toLowerCase().startsWith(search);
  });

  if (matches.length !== 1 || !matches[0].Username) {
    throw new Error(
      matches.length === 0
        ? `No Cognito account matched “${search}”.`
        : `More than one Cognito account matched “${search}”; use the exact Cognito username.`,
    );
  }

  await client.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: outputs.auth.user_pool_id,
      Username: matches[0].Username,
      GroupName: 'ADMINS',
    }),
  );

  console.log(`Granted global administrator access to Cognito user ${matches[0].Username}.`);
}

void main();
