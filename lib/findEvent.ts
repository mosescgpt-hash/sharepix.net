import { authModeFor, getClient } from '@/lib/dataClient';

/**
 * Look an event up by its three-word code.
 *
 * Split out of `lib/api.ts` for the same reason as `lib/trackEvent.ts`: `/join`
 * is a page a guest reaches with a code from a printed sign, often on venue
 * wifi, and it needs this one call. Importing it from `api.ts` handed that
 * guest the entire host dashboard's worth of code first.
 */
export async function findEventByCode(code: string): Promise<string | null> {
  const { data, errors } = await getClient().queries.findEventByCode(
    { code },
    { authMode: await authModeFor() },
  );
  if (errors?.length) throw new Error(errors.map((e) => e.message).join(' · '));
  return data?.found ? (data.eventId ?? null) : null;
}
