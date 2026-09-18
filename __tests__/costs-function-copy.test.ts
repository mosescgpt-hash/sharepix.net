import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * The cost rules exist twice, and the money page believes the copy.
 *
 * Amplify functions cannot import from `lib/`, so `lib/costs.ts` is duplicated
 * into the function that actually talks to the providers. If the two drift, the
 * dashboard and the saved report can disagree about what is owed — and the
 * saved report is the one that gets filed.
 */

describe('the copy has not drifted', () => {
  it('matches lib/costs.ts below the header', () => {
    expect(bodyOf(readSource('amplify/functions/cost-summary/costs.ts'))).toBe(
      bodyOf(readSource('lib/costs.ts')),
    );
  });
});

describe('the cost-summary handler', () => {
  const handler = codeOnly(readSource('amplify/functions/cost-summary/handler.ts'));

  it('asks Cost Explorer for unblended cost', () => {
    // Amortized spreads reservations across the month. It reads better and is
    // not what leaves the bank, which is the question this page answers.
    expect(handler).toContain("Metrics: ['UnblendedCost']");
    expect(handler).not.toContain('AmortizedCost');
  });

  it('points Cost Explorer at us-east-1', () => {
    // It is a global service with one endpoint. Using the deployment's region
    // fails with an unhelpful credentials error.
    expect(handler).toContain("CostExplorerClient({ region: 'us-east-1' })");
  });

  it('takes Stripe fees from balance transactions, not from a recomputed rate', () => {
    // 2.9% + 30¢ recomputed is right until a conversion, a dispute fee or a
    // rate change makes it wrong, and it would be wrong silently.
    expect(handler).toContain('balanceTransactions.list');
    expect(handler).not.toContain('0.029');
  });

  it('caches, because Cost Explorer bills per request', () => {
    expect(handler).toContain('CACHE_TTL_MS');
    expect(handler).toContain('readCache()');
    expect(handler).toContain('writeCache(result)');
  });

  it('only skips the cache when the caller asks', () => {
    expect(handler).toContain('if (isCurrentMonth && !args.refresh)');
  });

  it('caches only the current month', () => {
    // A historical period is fixed, but it shares one cache row. Storing a
    // report for March under the current-month key would serve March as today.
    expect(handler).toContain('if (isCurrentMonth) await writeCache(result);');
  });

  it('turns a provider failure into a missing line, not a failed answer', () => {
    // Four of five numbers is worth showing. Throwing gives a blank page.
    expect(handler).toContain('unavailableReason');
    expect(handler).toContain('reason: describe(error)');
  });

  it('says which Cloudflare variables are missing rather than reporting no cost', () => {
    // A blank R2 line looks like zero, and zero is the answer that lets you
    // believe a total that is short.
    expect(handler).toContain('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set');
    expect(handler).toContain('read at build time, not at run time');
  });

  it('prices R2 through the shared rule rather than inline arithmetic', () => {
    expect(handler).toContain('r2CostUsd({');
    expect(handler).not.toContain('0.015');
  });

  it('counts only completed payments and submitted print orders', () => {
    // A pending checkout is not revenue. It is somebody who opened a page.
    expect(handler).toContain("row.status?.S === 'complete'");
    expect(handler).toContain("row.status?.S !== 'pending'");
  });

  it('runs every provider concurrently', () => {
    // Cost Explorer is slow and Stripe is paginated. In series this is a
    // page that takes a minute to answer.
    expect(handler).toContain('await Promise.all([');
  });
});

describe('the grants', () => {
  const backend = codeOnly(readSource('amplify/backend.ts'));

  it('gives the function read-only Cost Explorer', () => {
    expect(backend).toContain("actions: ['ce:GetCostAndUsage', 'ce:GetCostForecast']");
  });

  it('grants no Cost Explorer action that could change anything', () => {
    // Budgets, anomaly monitors and cost categories are all writable through
    // this family of APIs. None of them is needed to read a bill.
    for (const action of ['ce:Create', 'ce:Update', 'ce:Delete', 'budgets:']) {
      expect(backend).not.toContain(action);
    }
  });

  it('reads the money tables and writes none of them', () => {
    expect(backend).toContain('paymentTable.grantReadData(costSummaryFn)');
    expect(backend).toContain('printOrderTable.grantReadData(costSummaryFn)');
    expect(backend).toContain('refundTable.grantReadData(costSummaryFn)');
    expect(backend).not.toContain('paymentTable.grantWriteData(costSummaryFn)');
    expect(backend).not.toContain('refundTable.grantReadWriteData(costSummaryFn)');
  });

  it('writes only the settings table, which is where its cache lives', () => {
    expect(backend).toContain('settingTable.grantReadWriteData(costSummaryFn)');
  });
});

describe('the mutation', () => {
  const schema = codeOnly(readSource('amplify/data/resource.ts'));

  it('is admins only', () => {
    // It returns the account's bill and every sale. There is no version of
    // this a guest or a host should be able to call.
    const declaration = schema.slice(schema.indexOf('costSummary: a'));
    const authLine = declaration.slice(0, declaration.indexOf('.handler('));
    expect(authLine).toContain("allow.group('ADMINS')");
    expect(authLine).not.toContain('allow.guest');
    expect(authLine).not.toContain('allow.authenticated');
  });
});

describe('what may be filed as a report', () => {
  // Imported from the handler rather than re-derived: the point is that this
  // rule is the one the function actually applies.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { reportIdFor } = require('../amplify/functions/cost-summary/handler') as {
    reportIdFor: (
      start: Date,
      end: Date,
    ) => { id: string; period: 'month' | 'year'; label: string } | null;
  };

  const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it('names a calendar month after the month', () => {
    expect(reportIdFor(utc('2026-09-01'), utc('2026-10-01'))).toEqual({
      id: '2026-09',
      period: 'month',
      label: 'September 2026',
    });
  });

  it('names a calendar year after the year', () => {
    expect(reportIdFor(utc('2026-01-01'), utc('2027-01-01'))).toEqual({
      id: '2026',
      period: 'year',
      label: '2026',
    });
  });

  it('carries a month across a year boundary', () => {
    expect(reportIdFor(utc('2026-12-01'), utc('2027-01-01'))?.id).toBe('2026-12');
  });

  it('refuses a range that is not a whole period', () => {
    // A row labelled "12 Aug to 3 Sep" filed between the months is a record
    // nobody can reconcile, so it is not filed at all.
    expect(reportIdFor(utc('2026-08-12'), utc('2026-09-03'))).toBeNull();
    expect(reportIdFor(utc('2026-08-01'), utc('2026-10-01'))).toBeNull();
    expect(reportIdFor(utc('2026-01-01'), utc('2026-07-01'))).toBeNull();
  });

  it('keys a month and a year differently, so neither overwrites the other', () => {
    // Both cover January. If they shared an id, filing the year would destroy
    // the month.
    expect(reportIdFor(utc('2026-01-01'), utc('2026-02-01'))?.id).toBe('2026-01');
    expect(reportIdFor(utc('2026-01-01'), utc('2027-01-01'))?.id).toBe('2026');
  });
});

describe('filing', () => {
  const handler = codeOnly(readSource('amplify/functions/cost-summary/handler.ts'));

  it('never files the month still in progress', () => {
    // A report is a record of a period that ended. One covering eleven days of
    // September, filed as September, is wrong and looks right.
    expect(handler).toContain('if (args.save && !isCurrentMonth)');
  });

  it('keeps the answer when filing fails', () => {
    expect(handler).toContain("console.error('COST REPORT NOT SAVED'");
  });
});

describe('the scheduled filing', () => {
  const monthly = codeOnly(readSource('amplify/functions/monthly-report/handler.ts'));

  it('rides the report job that already knows what last month was', () => {
    expect(monthly).toContain('await fileCostReports(current);');
  });

  it('files the year only when the month that ended was December', () => {
    expect(monthly).toContain('if (current.start.getUTCMonth() === 11)');
  });

  it('cannot stop a host reminder going out', () => {
    // This job's real purpose is telling hosts their gallery is about to
    // expire. A cost report is not worth one of those.
    expect(monthly).toContain("console.error('COST REPORT NOT FILED'");
  });

  it('invokes the cost function rather than recomputing a month', () => {
    // Same reason the daily job invokes the print check: one definition of
    // what a month cost, and the filed copy is the one nobody re-reads.
    expect(monthly).toContain('COST_SUMMARY_FUNCTION');
    expect(monthly).not.toContain('GetCostAndUsage');
  });
});
