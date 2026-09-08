import { LIST_MAX_PAGES, LIST_PAGE_LIMIT, listAllPages, type ListPage } from '../lib/listPages';
import { codeOnly, readSource } from './sourceGuards';

/**
 * Four list calls in lib/api.ts took the first page and discarded the
 * `nextToken`, so they returned fewer rows than existed and said nothing about
 * it. On an owner-scoped list that is not merely incomplete: DynamoDB applies
 * the page limit before the owner filter, so a host could get an empty array
 * back while their events sat in the next page.
 */

/** A fake paged source: `pages` is what each successive call returns. */
function pagedSource<T>(pages: ListPage<T>[]) {
  const seen: Array<string | null | undefined> = [];
  let call = 0;
  const fetchPage = async (nextToken?: string | null) => {
    seen.push(nextToken);
    return pages[call++] ?? { data: [], nextToken: null };
  };
  return { fetchPage, seen, calls: () => call };
}

describe('listAllPages', () => {
  it('returns every page, not just the first', async () => {
    const source = pagedSource([
      { data: ['a', 'b'], nextToken: 't1' },
      { data: ['c', 'd'], nextToken: 't2' },
      { data: ['e'], nextToken: null },
    ]);

    await expect(listAllPages(source.fetchPage, 'nope')).resolves.toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(source.calls()).toBe(3);
  });

  it('feeds each page its predecessor’s token', async () => {
    const source = pagedSource([
      { data: ['a'], nextToken: 't1' },
      { data: ['b'], nextToken: 't2' },
      { data: ['c'], nextToken: null },
    ]);

    await listAllPages(source.fetchPage, 'nope');

    // The first call asks for no token; each later one carries the token the
    // page before it returned. Passing the same token twice would loop forever.
    expect(source.seen).toEqual([undefined, 't1', 't2']);
  });

  it('keeps following a token after an empty page', async () => {
    // The owner-filter case: DynamoDB read a full page, the filter removed
    // every row, and the token is the only reason to keep looking. Stopping
    // here is exactly how a host lost their own events.
    const source = pagedSource([
      { data: [], nextToken: 't1' },
      { data: [], nextToken: 't2' },
      { data: ['mine'], nextToken: null },
    ]);

    await expect(listAllPages(source.fetchPage, 'nope')).resolves.toEqual(['mine']);
  });

  it('stops when the token clears', async () => {
    const source = pagedSource([{ data: ['only'], nextToken: null }]);
    await listAllPages(source.fetchPage, 'nope');
    expect(source.calls()).toBe(1);
  });

  it('treats a missing token the same as a cleared one', async () => {
    const source = pagedSource([{ data: ['only'] }]);
    await expect(listAllPages(source.fetchPage, 'nope')).resolves.toEqual(['only']);
    expect(source.calls()).toBe(1);
  });

  it('tolerates a page with no data field', async () => {
    const source = pagedSource<string>([
      { nextToken: 't1' },
      { data: ['a'], nextToken: null },
    ]);
    await expect(listAllPages(source.fetchPage, 'nope')).resolves.toEqual(['a']);
  });

  it('throws on a failed page rather than returning a short list', async () => {
    // A partial list that looks complete is the whole failure mode here, so a
    // page that errored must not be quietly skipped past.
    const source = pagedSource<string>([
      { data: ['a'], nextToken: 't1' },
      { errors: [{ message: 'boom' }] },
    ]);

    await expect(listAllPages(source.fetchPage, 'Events could not be loaded.')).rejects.toThrow(
      'Events could not be loaded.',
    );
  });

  it('gives up at the page ceiling, and says so', async () => {
    // A token that never clears must not hang the tab — but stopping quietly
    // would reintroduce the bug from the other side, so it warns.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    const endless = async () => {
      calls += 1;
      return { data: ['x'], nextToken: 'forever' };
    };

    const rows = await listAllPages(endless, 'nope');

    expect(calls).toBe(LIST_MAX_PAGES);
    expect(rows).toHaveLength(LIST_MAX_PAGES);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('asks for a full page each time', () => {
    expect(LIST_PAGE_LIMIT).toBe(1000);
  });
});

describe('lib/api.ts list calls', () => {
  const source = codeOnly(readSource('lib/api.ts'));

  /**
   * Every `.list(`/`.listPhotoByEventId(` call must page. Two shapes count: the
   * call passes `nextToken` (it is inside a pager), or it is a bare
   * `listAllPages(` call site. Checked against code with comments stripped, so
   * a sentence explaining pagination cannot stand in for doing it.
   */
  it('every model list call follows its token', () => {
    const callSites = source.split('\n').flatMap((line, index) => {
      const match = /client\.models\.\w+\.(list|listPhotoByEventId|list\w+)\(/.exec(line);
      return match ? [{ line: index + 1, text: line.trim() }] : [];
    });

    // If this drops to zero the regex has gone stale and the guard is asleep.
    expect(callSites.length).toBeGreaterThan(0);

    const unpaged = callSites.filter((site) => {
      // Look at the call and the few lines after it — the options object is
      // usually on its own lines.
      const window = source.split('\n').slice(site.line - 1, site.line + 6).join('\n');
      return !window.includes('nextToken');
    });

    expect(unpaged).toEqual([]);
  });

  it('no longer downloads every photo in the system', () => {
    // listAllPhotos existed only to count photos for the admin page, and it
    // capped at one page. Event.photoCount carries the same number, is
    // maintained atomically by create/delete, and does not grow the payload.
    expect(source).not.toContain('listAllPhotos');
  });
});

describe('the admin dashboard photo counts', () => {
  const source = codeOnly(readSource('pages/global-admin.tsx'));

  it('reads the counter on the event row', () => {
    expect(source).toContain('event.photoCount');
  });

  it('does not rebuild counts by listing photos', () => {
    expect(source).not.toContain('listAllPhotos');
    expect(source).not.toContain('photoCounts');
  });
});
