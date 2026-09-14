import { generateClient } from 'aws-amplify/data';
import { getCurrentUser } from 'aws-amplify/auth';
import type { Schema } from '@/amplify/data/resource';

/**
 * The Amplify data client, and the auth mode every call needs.
 *
 * ## Why this is its own module
 *
 * `lib/api.ts` is one 3,200-line file that 37 other files import. A bundler
 * splits by module, not by function, so a page importing a single symbol from
 * it received all of it: the homepage shipped the photo upload path, the
 * download path and the print checkout to show marketing copy to a logged-out
 * stranger. Measured, that was 30 KB gzipped on `/` alone.
 *
 * The fix is not to break `api.ts` into 37 pieces. It is to let the cheapest
 * pages import only what they use, which needs one thing both they and `api.ts`
 * can share without either pulling in the other.
 *
 * **Import direction is what makes that work.** `api.ts` imports this module;
 * this module imports nothing of `api.ts`. So a page reaching here never
 * reaches there, and no code is duplicated to achieve it.
 *
 * ## Why the client is lazy
 *
 * It used to be a bare `generateClient<Schema>()` at module scope in `api.ts`.
 * A top-level call is a side effect a bundler cannot prove away, so nothing in
 * that file could ever be dropped. It is also more correct: `Amplify.configure`
 * runs in `_app`, and a module-scope client is built during import, before that
 * has necessarily happened.
 */

let dataClient: ReturnType<typeof generateClient<Schema>> | null = null;

/** The shared Amplify data client, created on first use. */
export function getClient(): ReturnType<typeof generateClient<Schema>> {
  dataClient ??= generateClient<Schema>();
  return dataClient;
}

export type DataAuthMode = 'userPool' | 'identityPool';

/**
 * Which credentials to make a call with.
 *
 * Signed-in hosts go through the user pool; everyone else — every guest at
 * every event — through the identity pool's unauthenticated role.
 */
export async function authModeFor(): Promise<DataAuthMode> {
  try {
    await getCurrentUser();
    return 'userPool';
  } catch {
    // Signed out throws here. That is the common case, not an error.
    return 'identityPool';
  }
}
