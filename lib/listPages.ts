/**
 * Following a paginated list query to the end.
 *
 * Amplify's `list` returns one DynamoDB page plus a `nextToken`, and a caller
 * that ignores the token gets fewer rows than exist with nothing to say so.
 * That is worse than an error: nothing distinguishes "there are none" from "we
 * stopped looking after the first page".
 *
 * Owner-scoped lists make it sharper still. `Event` has no index on `owner`
 * (see amplify/data/resource.ts), so owner auth resolves to a Scan with the
 * owner condition as a filter expression — and DynamoDB applies `Limit` to rows
 * *read*, then filters. A host whose events sit past the first scanned page
 * gets back an empty array and a token, so discarding the token loses their
 * events entirely. Following it is the fix. An index on `owner` is the cure,
 * because this still reads the whole table to find one host's rows.
 *
 * Kept in its own file, with no `@/` imports, so the node test project can
 * import it relatively — lib/api.ts cannot be imported there at all.
 */

/** Rows DynamoDB examines per page. Not the number of rows that come back. */
export const LIST_PAGE_LIMIT = 1000;

/**
 * Stop after this many pages rather than loop forever on a token that never
 * clears. 100 pages is 100,000 rows examined — past any table here, and well
 * short of a hung browser tab.
 */
export const LIST_MAX_PAGES = 100;

export type ListPage<T> = {
  data?: T[] | null;
  nextToken?: string | null;
  errors?: ReadonlyArray<{ message: string }> | null;
};

/**
 * Every page of a list query, not just the first.
 *
 * Throws `failureMessage` if any page reports errors: a partial list that looks
 * complete is the failure mode this exists to prevent, so a page that failed
 * must not be silently skipped over.
 */
export async function listAllPages<T>(
  fetchPage: (nextToken?: string | null) => Promise<ListPage<T>>,
  failureMessage: string,
): Promise<T[]> {
  const rows: T[] = [];
  let nextToken: string | null | undefined;
  let pages = 0;

  do {
    const page = await fetchPage(nextToken);
    if (page.errors?.length) throw new Error(failureMessage);
    if (page.data?.length) rows.push(...page.data);
    nextToken = page.nextToken;
    pages += 1;

    if (nextToken && pages >= LIST_MAX_PAGES) {
      // Say so rather than return a short list quietly. Quietly is the bug this
      // helper exists to fix, and it would be no better for having come from
      // the guard than from a discarded token.
      console.warn(`Stopped paging after ${LIST_MAX_PAGES} pages; this list is truncated.`, {
        rows: rows.length,
      });
      break;
    }
  } while (nextToken);

  return rows;
}
