/**
 * The pure parts of the account email lookup, kept apart so they are tested.
 */

/** The most subs one request may ask about. */
export const MAX_SUBS = 500;

/** The most ListUsers pages one request will read (60 accounts each). */
export const MAX_PAGES = 100;

const SUB = /^[0-9a-f-]{36}$/i;

/** The valid, distinct subs from a request, capped at MAX_SUBS. */
export function requestedSubs(raw: readonly (string | null | undefined)[] | null | undefined): string[] {
  const subs = new Set<string>();
  for (const value of raw ?? []) {
    const sub = (value ?? '').trim().toLowerCase();
    if (SUB.test(sub)) subs.add(sub);
    if (subs.size >= MAX_SUBS) break;
  }
  return [...subs];
}

/** The sub and email from one Cognito user's attributes, when both are there. */
export function subAndEmail(
  attributes: readonly { Name?: string; Value?: string }[] | undefined,
): { sub: string; email: string } | null {
  const get = (name: string) => attributes?.find((a) => a.Name === name)?.Value?.trim() ?? '';
  const sub = get('sub').toLowerCase();
  const email = get('email');
  return sub && email ? { sub, email } : null;
}
