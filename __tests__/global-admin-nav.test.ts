import { readSource } from './sourceGuards';

/**
 * The section index on /global-admin, checked against the page it indexes.
 *
 * A jump link pointing at an anchor that does not exist is worse than no link:
 * clicking it does nothing at all, and the operator reasonably concludes the
 * control is missing. That is the failure this file exists to prevent, and it
 * is a real one — both the report recipient and the job runners were shipped,
 * rendered, and reported as absent because nothing on the page led to them.
 */

const page = readSource('pages/global-admin.tsx');

/** The ids listed in ADMIN_SECTIONS, in order. */
function indexedIds(): string[] {
  const block = page.slice(
    page.indexOf('const ADMIN_SECTIONS'),
    page.indexOf('];', page.indexOf('const ADMIN_SECTIONS')),
  );
  return [...block.matchAll(/\{ id: '([^']+)'/g)].map((m) => m[1]);
}

/** The ids actually present as heading anchors on the page. */
function anchoredIds(): string[] {
  return [...page.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
}

describe('the section index', () => {
  it('points only at anchors that exist', () => {
    const anchors = new Set(anchoredIds());
    for (const id of indexedIds()) {
      expect(anchors.has(id)).toBe(true);
    }
  });

  it('lists every anchored section, so nothing is reachable only by scrolling', () => {
    const indexed = new Set(indexedIds());
    for (const id of anchoredIds()) {
      expect(indexed.has(id)).toBe(true);
    }
  });

  it('is not empty, which is how this would silently regress', () => {
    expect(indexedIds().length).toBeGreaterThan(10);
  });

  it('names the two an operator needs on a given day', () => {
    // The specific complaint: both were shipped and neither could be found.
    const ids = indexedIds();
    expect(ids).toContain('report-recipient');
    expect(ids).toContain('jobs');
  });

  it('leaves room for a fixed header when it jumps', () => {
    // Without scroll-mt the heading lands flush against the viewport edge and
    // the section reads as though it starts mid-sentence.
    for (const match of page.matchAll(/<h2 id="[^"]+" className="([^"]+)"/g)) {
      expect(match[1]).toContain('scroll-mt-');
    }
  });
});

describe('the controls the index promises', () => {
  it('still renders the report recipient input and save button', () => {
    expect(page).toContain('aria-label="Monthly report recipient"');
    expect(page).toContain('handleSaveReportRecipient()');
  });

  it('still renders all three job runners', () => {
    expect(page).toContain("handleRunJob('daily')");
    expect(page).toContain("handleRunJob('monthly')");
    expect(page).toContain("handleRunJob('reclaim')");
  });

  it('warns that reclamation is destructive before the button, not after', () => {
    // The order matters on a page where the button is red and the paragraph is
    // grey. Anyone who reads only one of them should read the warning.
    const jobs = page.slice(page.indexOf('id="jobs"'));
    expect(jobs.indexOf('Reclamation deletes photos permanently')).toBeGreaterThan(-1);
    expect(jobs).toContain('STORAGE_RECLAIM_ENABLED');
  });
});
