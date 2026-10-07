import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import { MAX_PAGES, requestedSubs, subAndEmail } from './lookup';

const client = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID as string;

type Handler = Schema['accountEmails']['functionHandler'];

/**
 * The account email for each requested sub, as far as the pool has one.
 *
 * Cognito's ListUsers filter matches one value per call, so rather than one
 * call per trial this pages through the pool (60 accounts a call, only `sub`
 * and `email` returned) and stops as soon as every requested sub is found.
 * A sub with no account behind it — a deleted user — is simply left out.
 */
export const handler: Handler = async (event) => {
  const wanted = new Set(requestedSubs(event.arguments.subs));
  const found: { sub: string; email: string }[] = [];
  if (wanted.size === 0 || !USER_POOL_ID) return found;

  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await client.send(
      new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        AttributesToGet: ['sub', 'email'],
        Limit: 60,
        PaginationToken: token,
      }),
    );
    for (const user of res.Users ?? []) {
      const pair = subAndEmail(user.Attributes);
      if (pair && wanted.delete(pair.sub)) found.push(pair);
    }
    token = res.PaginationToken;
    if (!token || wanted.size === 0) break;
  }
  return found;
};
