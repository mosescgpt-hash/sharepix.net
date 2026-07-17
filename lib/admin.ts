import { fetchAuthSession } from 'aws-amplify/auth';

export async function isGlobalAdmin(): Promise<boolean> {
  const session = await fetchAuthSession({ forceRefresh: true });
  const groups = session.tokens?.idToken?.payload['cognito:groups'];
  return Array.isArray(groups) && groups.includes('ADMINS');
}
