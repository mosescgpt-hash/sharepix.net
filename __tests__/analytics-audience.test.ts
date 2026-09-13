import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldCount, skipReason, type Viewer } from '../lib/analyticsAudience';

const viewer = (over: Partial<Viewer> = {}): Viewer => ({
  isAdmin: false,
  browserExcluded: false,
  ...over,
});

describe('who the funnel counts', () => {
  it('counts an ordinary signed-out visitor', () => {
    expect(shouldCount(viewer())).toBe(true);
    expect(skipReason(viewer())).toBeNull();
  });

  it('counts a signed-in customer, who is not an admin', () => {
    expect(shouldCount(viewer({ isAdmin: false }))).toBe(true);
  });

  it('does not count a signed-in admin', () => {
    expect(shouldCount(viewer({ isAdmin: true }))).toBe(false);
    expect(skipReason(viewer({ isAdmin: true }))).toBe('signed-in-admin');
  });

  it('does not count a browser already recognised as an admin, even signed out', () => {
    // The case the group check alone misses, and the common one: looking at
    // your own marketing site from a logged-out tab.
    const seen = viewer({ isAdmin: null, browserExcluded: true });
    expect(shouldCount(seen)).toBe(false);
    expect(skipReason(seen)).toBe('known-browser');
  });
});

describe('which way it fails', () => {
  // Toward counting. An over-count of a few of the operator's own views is
  // small and self-correcting; a check that silently suppressed everything
  // would make the funnel look dead and hide that it was doing it.
  it('counts the visit when the admin check could not be made', () => {
    expect(shouldCount(viewer({ isAdmin: null }))).toBe(true);
    expect(skipReason(viewer({ isAdmin: null }))).toBeNull();
  });

  it('treats only a definite yes as an admin', () => {
    for (const value of [null, false] as const) {
      expect(shouldCount(viewer({ isAdmin: value }))).toBe(true);
    }
  });
});

describe('the storage helpers', () => {
  // They run in a browser; what matters here is that they cannot throw, since
  // Safari in private mode throws on localStorage rather than returning null
  // and a funnel helper must never be what breaks a page.
  it('wraps every storage access', () => {
    const source = readFileSync(join(__dirname, '..', 'lib', 'analyticsAudience.ts'), 'utf8');
    const accesses = source.match(/window\.localStorage\.\w+/g) ?? [];
    expect(accesses.length).toBeGreaterThanOrEqual(3);
    const tries = source.match(/try \{/g) ?? [];
    expect(tries.length).toBeGreaterThanOrEqual(accesses.length);
  });

  it('offers a documented way to undo the per-browser flag', () => {
    const source = readFileSync(join(__dirname, '..', 'lib', 'analyticsAudience.ts'), 'utf8');
    expect(source).toContain('stopExcludingThisBrowser');
    // The key is named in the doc comment, so "why is my traffic zero" has a
    // one-line answer that does not require reading the module.
    expect(source).toContain("localStorage.removeItem('spx.analytics.exclude')");
  });
});

describe('what it deliberately leaves alone', () => {
  it('is not wired into the server-written events', () => {
    // purchase_completed and the milestones are facts about rows. An event the
    // operator created is a real event, and suppressing it would make the
    // funnel disagree with the events table.
    for (const fn of ['record-analytics', 'stripe-webhook', 'create-event']) {
      const source = readFileSync(
        join(__dirname, '..', 'amplify', 'functions', fn, 'handler.ts'),
        'utf8',
      );
      expect(source).not.toContain('analyticsAudience');
      expect(source).not.toContain('browserExcluded');
    }
  });
});
