import { readSource } from './sourceGuards';

/**
 * The Costs tab, checked for the two ways it could go wrong.
 *
 * The first is a page that costs money to look at: Cost Explorer bills per
 * request, so anything that refetches on render turns a page about spending
 * into spending. The second is a total that reads as complete when it is not —
 * the failure this whole feature is built to avoid.
 */

const page = readSource('pages/global-admin.tsx');

describe('the tab', () => {
  it('exists, and opens on Events rather than on Costs', () => {
    // Events is the tab with something to do on a normal day. Costs is a thing
    // you go and look at.
    expect(page).toContain("export type AdminTab = 'events' | 'discounts' | 'metrics' | 'costs' | 'tests'");
    expect(page).toContain("useState<AdminTab>('events')");
  });

  it('indexes both of its panels', () => {
    expect(page).toContain("{ id: 'costs', label: 'This month', tab: 'costs' }");
    expect(page).toContain("{ id: 'declared-costs', label: 'Costs you enter', tab: 'costs' }");
  });
});

describe('what it costs to look at', () => {
  it('loads only when the Costs tab is open', () => {
    // Not on mount: most visits here are about an event, and this reaches four
    // providers.
    expect(page).toContain("if (adminTab !== 'costs') return;");
  });

  it('auto-loads from the cache, never with refresh', () => {
    // The automatic path must be the free one. A `true` here would spend a cent
    // every time somebody opened the tab.
    expect(page).toContain('void handleLoadCosts(false);');
  });

  it('spends a Cost Explorer request only on an explicit press', () => {
    expect(page).toContain('onClick={() => void handleLoadCosts(true)}');
    // And says so on the button, so the cost is not a surprise.
    expect(page).toContain("'Refresh (1¢)'");
  });

  it('does not refetch when the summary is already loaded', () => {
    // `costs` in the guard is what stops the effect looping: setCosts triggers
    // a render, which runs the effect again. Same for the reports list.
    const effect = page.slice(page.indexOf("if (adminTab !== 'costs') return;"));
    expect(effect.slice(0, 300)).toContain('if (costs || costsError');
    expect(effect.slice(0, 300)).toContain('if (!reports && !reportsError)');
  });
});

describe('what the page shows about trust', () => {
  it('leads with the headline the function computed, not one of its own', () => {
    // Two implementations of a money figure diverge, and the saved report would
    // be the one that was wrong.
    expect(page).toContain('{costs.cashHeadline}');
    expect(page).toContain('{costs.netHeadline}');
  });

  it('prints how each figure is known, next to the figure', () => {
    expect(page).toContain('{account.provenance}');
    expect(page).toContain('{account.basis}');
  });

  it('shows an unreachable provider as unknown, not as zero', () => {
    expect(page).toContain('costLine.amountUsd === null');
    expect(page).toContain('{costLine.unavailableReason}');
  });

  it('says how old a cached answer is', () => {
    expect(page).toContain('costs.cached');
    expect(page).toContain('press Refresh for a live one');
  });

  it('says how old a declared figure is', () => {
    expect(page).toContain('you entered this');
  });

  it('warns that the domain may already be inside the AWS bill', () => {
    expect(page).toContain('account.mayDuplicate');
    expect(page).toContain('is counted twice');
  });

  it('keeps the money-to-find total apart from what buyers cover', () => {
    expect(page).toContain('To have ready');
    expect(page).toContain('Covered by buyers');
    expect(page).toContain('buyer pays');
  });

  it('carries the list of what it cannot see', () => {
    expect(page).toContain('COSTS_NOT_COVERED.map');
  });
});
