/**
 * The owner string on an Event, written in one place and read in another.
 *
 * ## The bug this module exists to prevent
 *
 * `create-event` composed the owner as `<sub>::<username>`, and `my-events`
 * guessed at the same string with its own rule. The two disagreed, and the
 * disagreement was invisible for months because AppSync papers over it for
 * ordinary hosts: when a host is authorized by the owner rule, the resolver
 * **replaces** the owner argument with the caller's own claim before the query
 * runs, so whatever the client passed is discarded and the right rows come back
 * regardless.
 *
 * A **global admin** is authorized by their group first. The substitution is
 * skipped, the value the client sent is the value used — and the guess was
 * wrong, so the page showed an administrator none of their own events and no
 * error, because zero rows is a perfectly successful query.
 *
 * The specific disagreement: this pool signs in with email, so Cognito's
 * username is a UUID that **equals the sub**. `ownerStringFor` appends any
 * non-empty username, producing `<sub>::<sub>`; the reader skipped the
 * `::` form whenever the username matched the sub, and asked for a bare
 * `<sub>` that is never written.
 *
 * So the reader now builds its candidates by calling the writer. The two
 * cannot drift again without the function itself changing, which is the only
 * kind of guarantee that has held up in this codebase.
 */

/**
 * How an event's `owner` is stored.
 *
 * Byte-identical to `ownerStringFor` in
 * `amplify/functions/create-event/newEvent.ts` — Amplify functions cannot
 * import from `lib/`, so it exists twice, and
 * `__tests__/event-owner.test.ts` fails if they drift.
 */
export function ownerStringFor(sub: string, username: string): string {
  const id = (sub ?? '').trim();
  if (!id) return '';
  const name = (username ?? '').trim();
  return name ? `${id}::${name}` : id;
}

/**
 * Every owner string this account's events could be stored under, best first.
 *
 * The first is what `ownerStringFor` writes today, derived rather than guessed.
 * The bare sub is kept behind it for rows written before an identity carried a
 * username — those exist, and a query for them costs one indexed lookup.
 *
 * Returns an empty list for a caller with no subject, so a malformed identity
 * asks for nothing rather than asking for `''` and matching whatever happens to
 * carry an empty owner.
 */
export function ownerCandidatesFor(sub: string, username: string): string[] {
  const id = (sub ?? '').trim();
  if (!id) return [];
  const written = ownerStringFor(id, username);
  return written === id ? [id] : [written, id];
}

/**
 * Whether a stored owner string belongs to this subject.
 *
 * Used to check what an index returned against who asked. An index is a
 * denormalised copy, and a global admin can read every row, so this is what
 * stops either from quietly putting somebody else's event on the page.
 *
 * Deliberately anchored rather than a substring test: `includes` would match a
 * sub that happens to contain another sub, and would match the username half
 * of an unrelated row.
 */
export function ownerIsSubject(owner: string | null | undefined, sub: string): boolean {
  const value = (owner ?? '').trim();
  const id = (sub ?? '').trim();
  if (!value || !id) return false;
  return value === id || value.startsWith(`${id}::`);
}
