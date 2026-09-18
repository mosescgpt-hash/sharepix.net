import {
  COSTS_NOT_COVERED,
  COST_ACCOUNTS,
  DECLARED_STALE_AFTER_DAYS,
  PROJECTION_MIN_ELAPSED,
  R2_FREE_TIER,
  R2_RATES,
  type CostLine,
  accountFor,
  cashHeadline,
  daysSince,
  grossRevenue,
  isStale,
  monthProgress,
  netHeadline,
  profitAndLoss,
  projectMonthEnd,
  r2CostUsd,
  summarize,
} from '../lib/costs';

const NOW = new Date('2026-09-18T12:00:00Z');

const line = (over: Partial<CostLine> & Pick<CostLine, 'accountId'>): CostLine => ({
  amountUsd: 0,
  asOf: NOW.toISOString(),
  ...over,
});

describe('the account catalogue', () => {
  it('has a unique id for every account', () => {
    const ids = COST_ACCOUNTS.map((account) => account.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks exactly the buyer-funded accounts as pass-through', () => {
    // Prints and card fees arrive with their own funding; everything else is
    // owed whether or not anybody buys anything. Getting this list wrong is the
    // difference between "have $40 ready" and "have $400 ready".
    const passThrough = COST_ACCOUNTS.filter((a) => a.passThrough).map((a) => a.id);
    expect(passThrough.sort()).toEqual(['prodigi', 'stripe']);
  });

  it('gives every account that can charge you a basis saying what would make it wrong', () => {
    for (const account of COST_ACCOUNTS) {
      expect(account.covers).not.toBe('');
      expect(account.basis).not.toBe('');
      // A free account needs no explanation beyond "free". One that can bill
      // you does: the basis is what tells you how far to trust its figure.
      if (account.provenance !== 'free') {
        expect(account.basis.length).toBeGreaterThan(40);
      }
    }
  });

  it('flags the domain as possibly already inside the AWS bill', () => {
    expect(accountFor('domain')?.mayDuplicate).toBe('aws');
  });
});

describe('R2 cost', () => {
  it('is zero inside the free tier', () => {
    expect(
      r2CostUsd({
        storageGbMonth: R2_FREE_TIER.storageGbMonth,
        classAOperations: R2_FREE_TIER.classAOperations,
        classBOperations: R2_FREE_TIER.classBOperations,
      }),
    ).toBe(0);
  });

  it('charges only for what exceeds the free tier, per component', () => {
    // 20 GB stored is 10 billable; operations are inside their allowances and
    // must not offset the storage.
    const cost = r2CostUsd({
      storageGbMonth: 20,
      classAOperations: 500_000,
      classBOperations: 1_000_000,
    });
    expect(cost).toBeCloseTo(10 * R2_RATES.storagePerGbMonth, 2);
  });

  it('does not let a spare allowance in one component pay for another', () => {
    // The bug this guards: subtracting the free tier from a combined total.
    // Storage over, operations far under — a combined subtraction reports zero.
    const cost = r2CostUsd({
      storageGbMonth: 1_000,
      classAOperations: 0,
      classBOperations: 0,
    });
    expect(cost).toBeGreaterThan(14);
  });

  it('charges for operations past the allowance', () => {
    const cost = r2CostUsd({
      storageGbMonth: 0,
      classAOperations: R2_FREE_TIER.classAOperations + 1_000_000,
      classBOperations: R2_FREE_TIER.classBOperations + 1_000_000,
    });
    expect(cost).toBeCloseTo(R2_RATES.classAPerMillion + R2_RATES.classBPerMillion, 2);
  });
});

describe('staleness', () => {
  it('counts whole days', () => {
    expect(daysSince('2026-09-15T12:00:00Z', NOW)).toBe(3);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('not a date', NOW)).toBeNull();
  });

  it('goes stale only for declared figures', () => {
    const old = new Date(NOW.getTime() - (DECLARED_STALE_AFTER_DAYS + 1) * 86_400_000).toISOString();
    expect(isStale(line({ accountId: 'microsoft365', amountUsd: 6, asOf: old }), NOW)).toBe(true);
    // A measured figure carries its own timestamp from the provider; an old one
    // means the fetch is old, not that the number was typed in once.
    expect(isStale(line({ accountId: 'aws', amountUsd: 40, asOf: old }), NOW)).toBe(false);
  });

  it('treats a declared figure with no date as stale', () => {
    expect(isStale(line({ accountId: 'microsoft365', amountUsd: 6, asOf: null }), NOW)).toBe(true);
  });

  it('does not call a missing figure stale — it is missing, which is worse', () => {
    expect(isStale(line({ accountId: 'microsoft365', amountUsd: null, asOf: null }), NOW)).toBe(false);
  });
});

describe('summarize', () => {
  const lines: CostLine[] = [
    line({ accountId: 'aws', amountUsd: 41.2 }),
    line({ accountId: 'cloudflare-r2', amountUsd: 3.15 }),
    line({ accountId: 'microsoft365', amountUsd: 6 }),
    line({ accountId: 'stripe', amountUsd: 12.4 }),
    line({ accountId: 'prodigi', amountUsd: 30.05 }),
    line({ accountId: 'github', amountUsd: 0 }),
  ];

  it('separates money to find from money the sale funds', () => {
    const summary = summarize(lines, NOW);
    expect(summary.ownCostUsd).toBeCloseTo(50.35, 2);
    expect(summary.passThroughUsd).toBeCloseTo(42.45, 2);
    expect(summary.totalUsd).toBeCloseTo(92.8, 2);
  });

  it('reports how much of the own-cost figure came from a provider API', () => {
    // R2 and the mailbox are computed and declared; only AWS is measured here.
    expect(summarize(lines, NOW).measuredUsd).toBeCloseTo(41.2, 2);
  });

  it('names accounts it could not reach, and does not count them as zero', () => {
    const summary = summarize(
      [
        line({ accountId: 'aws', amountUsd: 41.2 }),
        line({ accountId: 'cloudflare-r2', amountUsd: null, unavailableReason: 'no token' }),
      ],
      NOW,
    );
    expect(summary.unavailable).toEqual(['cloudflare-r2']);
    expect(summary.ownCostUsd).toBeCloseTo(41.2, 2);
  });

  it('does not report a free account as a gap', () => {
    const summary = summarize([line({ accountId: 'github', amountUsd: null })], NOW);
    expect(summary.unavailable).toEqual([]);
  });

  it('lists stale declared lines', () => {
    const old = new Date(NOW.getTime() - 200 * 86_400_000).toISOString();
    const summary = summarize([line({ accountId: 'microsoft365', amountUsd: 6, asOf: old })], NOW);
    expect(summary.stale).toEqual(['microsoft365']);
  });
});

describe('month projection', () => {
  it('knows how far through the month it is', () => {
    const progress = monthProgress(NOW);
    expect(progress.daysInMonth).toBe(30);
    expect(progress.daysElapsed).toBe(17);
    expect(progress.elapsed).toBeGreaterThan(0.55);
    expect(progress.elapsed).toBeLessThan(0.6);
  });

  it('extends month-to-date spend to month end', () => {
    // 17.5 days of a 30-day month at $50 projects to roughly $86.
    const projected = projectMonthEnd(50, NOW);
    expect(projected).not.toBeNull();
    expect(projected as number).toBeGreaterThan(84);
    expect(projected as number).toBeLessThan(88);
  });

  it('refuses to project from the first days of the month', () => {
    const early = new Date('2026-09-02T00:00:00Z');
    expect(monthProgress(early).elapsed).toBeLessThan(PROJECTION_MIN_ELAPSED);
    expect(projectMonthEnd(50, early)).toBeNull();
  });
});

describe('the headline', () => {
  it('leads with what is missing rather than with a total it cannot stand behind', () => {
    const summary = summarize(
      [
        line({ accountId: 'aws', amountUsd: 41.2 }),
        line({ accountId: 'cloudflare-r2', amountUsd: null, unavailableReason: 'no token' }),
      ],
      NOW,
    );
    const text = cashHeadline(summary, 70, NOW);
    expect(text).toContain('At least $41.20');
    expect(text).toContain('Cloudflare R2');
    expect(text).toContain('higher');
  });

  it('says it is too early rather than projecting from two days', () => {
    const early = new Date('2026-09-02T00:00:00Z');
    const summary = summarize([line({ accountId: 'aws', amountUsd: 3 })], early);
    expect(cashHeadline(summary, projectMonthEnd(3, early), early)).toContain('too early');
  });

  it('gives the projection and what has been billed so far', () => {
    const summary = summarize([line({ accountId: 'aws', amountUsd: 41.2 })], NOW);
    const text = cashHeadline(summary, 70, NOW);
    expect(text).toContain('$70.00 to have ready');
    expect(text).toContain('$41.20');
  });
});

describe('profit and loss', () => {
  const summary = summarize(
    [
      line({ accountId: 'aws', amountUsd: 40 }),
      line({ accountId: 'stripe', amountUsd: 10 }),
      line({ accountId: 'prodigi', amountUsd: 25 }),
    ],
    NOW,
  );

  it('keeps event revenue and print revenue apart', () => {
    // A $12.66 print is not $12.66 earned, and a combined figure hides that.
    expect(grossRevenue({ eventsUsd: 316, printsUsd: 38, refundedUsd: 0 })).toBe(354);
  });

  it('subtracts refunds, pass-through costs and own costs', () => {
    const pl = profitAndLoss({ eventsUsd: 316, printsUsd: 38, refundedUsd: 79 }, summary);
    expect(pl.grossUsd).toBe(354);
    // 354 - 79 refunded - 35 pass-through - 40 own = 200
    expect(pl.netUsd).toBeCloseTo(200, 2);
    expect(pl.complete).toBe(true);
  });

  it('is marked incomplete when a cost could not be reached', () => {
    const gappy = summarize(
      [
        line({ accountId: 'aws', amountUsd: 40 }),
        line({ accountId: 'cloudflare-r2', amountUsd: null, unavailableReason: 'no token' }),
      ],
      NOW,
    );
    const pl = profitAndLoss({ eventsUsd: 100, printsUsd: 0, refundedUsd: 0 }, gappy);
    expect(pl.complete).toBe(false);
    expect(netHeadline(pl)).toContain('the real figure is worse');
  });

  it('says down rather than negative net', () => {
    const pl = profitAndLoss({ eventsUsd: 0, printsUsd: 0, refundedUsd: 0 }, summary);
    expect(pl.netUsd).toBeCloseTo(-75, 2);
    expect(netHeadline(pl)).toContain('Down $75.00');
  });

  it('says nothing happened when nothing happened', () => {
    const empty = summarize([], NOW);
    const pl = profitAndLoss({ eventsUsd: 0, printsUsd: 0, refundedUsd: 0 }, empty);
    expect(netHeadline(pl)).toBe('Nothing in, nothing out.');
  });
});

describe('what it does not cover', () => {
  it('names the gaps, including that this is not accounting', () => {
    expect(COSTS_NOT_COVERED.length).toBeGreaterThanOrEqual(5);
    expect(COSTS_NOT_COVERED.join(' ')).toContain('not accounting');
  });
});
