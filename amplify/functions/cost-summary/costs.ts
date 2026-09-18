/**
 * The cost-summary function's copy of the cost rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so this
 * exists more than once. Everything below the header is byte-identical to
 * lib/costs.ts and __tests__/costs-function-copy.test.ts fails if it drifts.
 *
 * The duplicated rates matter more here than in most of these pairs: two copies
 * that disagree about what R2 charges produce two different answers to "what do
 * I owe this month", and the one on the dashboard is the one somebody acts on.
 */

/** How much to trust a line. See the module comment. */
export type CostProvenance = 'measured' | 'computed' | 'declared' | 'free';

export type CostAccountId =
  | 'aws'
  | 'cloudflare-r2'
  | 'stripe'
  | 'prodigi'
  | 'microsoft365'
  | 'domain'
  | 'github'
  | 'cloudflare-analytics'
  | 'search-console';

export interface CostAccount {
  id: CostAccountId;
  label: string;
  /** What the money buys, in the operator's words. */
  covers: string;
  provenance: CostProvenance;
  /** Where the figure comes from, and what would make it wrong. */
  basis: string;
  /**
   * True when the buyer covers this cost at the point of sale.
   *
   * Pass-through costs are real costs and belong in the records. They are not
   * money to have ready: a print order that never happens costs nothing, and
   * one that does happen arrives with its own funding.
   */
  passThrough: boolean;
  /**
   * Another account whose bill may already include this one.
   *
   * Only the domain, today: if `sharepix.net` is registered through Route 53
   * its renewal is inside the AWS figure, and declaring it again would count it
   * twice. `docs/accounts.md` says "believed to be" Route 53, which is not
   * knowledge, so the page warns instead of guessing.
   */
  mayDuplicate?: CostAccountId;
}

/**
 * Every account that can cost money, and the two that cannot.
 *
 * The free ones are listed deliberately. An account missing from a costs page
 * reads as an oversight; an account listed at zero reads as a decision, and if
 * Cloudflare ever starts charging for Web Analytics there is a row to change
 * rather than a row to remember to add.
 */
export const COST_ACCOUNTS: readonly CostAccount[] = [
  {
    id: 'aws',
    label: 'AWS',
    covers: 'Everything: hosting, database, photos, email, logs, and WAF if it is on',
    provenance: 'measured',
    basis: 'Cost Explorer, month to date by service. This is the bill, not an estimate.',
    passThrough: false,
  },
  {
    id: 'cloudflare-r2',
    label: 'Cloudflare R2',
    covers: 'Photo reads. Storage and operations; egress is free, which is why reads come from here',
    provenance: 'computed',
    basis:
      'Usage is measured through the GraphQL analytics API; the cost is that usage times the rates below. Cloudflare has no "what do I owe" endpoint.',
    passThrough: false,
  },
  {
    id: 'stripe',
    label: 'Stripe',
    covers: 'Processing fees on every event, add-on and print sale',
    provenance: 'measured',
    basis: 'Balance transactions — the fee Stripe actually took, not 2.9% + 30¢ recomputed.',
    passThrough: true,
  },
  {
    id: 'prodigi',
    label: 'Prodigi',
    covers: 'Printing and shipping, per print order',
    provenance: 'computed',
    basis:
      'PrintOrder rows priced against the catalogue in prints.ts, which the Monday check compares against live quotes.',
    passThrough: true,
  },
  {
    id: 'microsoft365',
    label: 'Microsoft 365',
    covers: 'The @sharepix.net mailboxes. Every account-recovery email lands here',
    provenance: 'declared',
    basis: 'No API worth wiring. You enter it; the page shows when you last confirmed it.',
    passThrough: false,
  },
  {
    id: 'domain',
    label: 'Domain registration',
    covers: 'sharepix.net. The site stops resolving without it',
    provenance: 'declared',
    basis:
      'Annual. If it is registered through Route 53 the renewal is already inside the AWS figure — leave this at zero if so.',
    passThrough: false,
    mayDuplicate: 'aws',
  },
  {
    id: 'github',
    label: 'GitHub',
    covers: 'The repository and CI',
    provenance: 'free',
    basis: 'Free at this size. Listed so a future plan change has a row to land in.',
    passThrough: false,
  },
  {
    id: 'cloudflare-analytics',
    label: 'Cloudflare Web Analytics',
    covers: 'Page-view counts',
    provenance: 'free',
    basis: 'Free and cookieless.',
    passThrough: false,
  },
  {
    id: 'search-console',
    label: 'Google Search Console',
    covers: 'How SharePix appears in search',
    provenance: 'free',
    basis: 'Free.',
    passThrough: false,
  },
];

export function accountFor(id: CostAccountId): CostAccount | undefined {
  return COST_ACCOUNTS.find((account) => account.id === id);
}

/**
 * Cloudflare R2's published rates, and the date somebody checked them.
 *
 * Same standing as the Prodigi catalogue in `prints.ts`: nothing in this
 * repository can verify these, because the only source of truth is Cloudflare's
 * pricing page. Unlike Prodigi there is no weekly check that would catch a
 * change, so the R2 line is only as current as this date — which is why the
 * page shows the date next to the figure rather than hiding it here.
 */
export const R2_RATES_VERIFIED_ON = '2026-09-18';

export const R2_RATES = {
  /** USD per GB-month of stored data. */
  storagePerGbMonth: 0.015,
  /** USD per million class A operations (writes, lists). */
  classAPerMillion: 4.5,
  /** USD per million class B operations (reads). */
  classBPerMillion: 0.36,
  /** Egress is free. The entire reason reads come from R2 rather than S3. */
  egressPerGb: 0,
} as const;

/** What Cloudflare gives away each month before charging. */
export const R2_FREE_TIER = {
  storageGbMonth: 10,
  classAOperations: 1_000_000,
  classBOperations: 10_000_000,
} as const;

export interface R2Usage {
  /** Average stored bytes over the period, as GB-month. */
  storageGbMonth: number;
  classAOperations: number;
  classBOperations: number;
}

/**
 * What R2 usage costs, after the free tier.
 *
 * The free tier is subtracted per component rather than from the total, which
 * is how Cloudflare bills it: ten million reads do not offset a terabyte of
 * storage. Getting that backwards would report zero right up until the month it
 * mattered.
 */
export function r2CostUsd(usage: R2Usage): number {
  const billable = (used: number, free: number) => Math.max(0, used - free);
  const storage = billable(usage.storageGbMonth, R2_FREE_TIER.storageGbMonth) * R2_RATES.storagePerGbMonth;
  const classA =
    (billable(usage.classAOperations, R2_FREE_TIER.classAOperations) / 1_000_000) *
    R2_RATES.classAPerMillion;
  const classB =
    (billable(usage.classBOperations, R2_FREE_TIER.classBOperations) / 1_000_000) *
    R2_RATES.classBPerMillion;
  return round2(storage + classA + classB);
}

/** A declared figure older than this is shown as stale rather than as fact. */
export const DECLARED_STALE_AFTER_DAYS = 90;

/** One account's cost for a period. */
export interface CostLine {
  accountId: CostAccountId;
  /** USD. Zero is a real answer; null means nobody could find out. */
  amountUsd: number | null;
  /** When this figure was obtained or last confirmed, ISO 8601. */
  asOf: string | null;
  /** Detail worth showing under the line — a service breakdown, an order count. */
  detail?: string;
  /**
   * Why there is no figure. Set only when `amountUsd` is null.
   *
   * A missing number must say why it is missing. "Cloudflare token not set" is
   * actionable; a blank cell looks like zero and quietly understates the total.
   */
  unavailableReason?: string;
}

export function daysSince(asOf: string | null, now: Date): number | null {
  if (!asOf) return null;
  const at = Date.parse(asOf);
  if (!Number.isFinite(at)) return null;
  return Math.floor((now.getTime() - at) / 86_400_000);
}

/** True when a declared figure is old enough that nobody should rely on it. */
export function isStale(line: CostLine, now: Date): boolean {
  const account = accountFor(line.accountId);
  if (!account || account.provenance !== 'declared') return false;
  if (line.amountUsd === null) return false;
  const age = daysSince(line.asOf, now);
  return age === null || age >= DECLARED_STALE_AFTER_DAYS;
}

export interface CostSummary {
  /** Money that has to come from somewhere: everything not pass-through. */
  ownCostUsd: number;
  /** Covered by the buyer at the point of sale. */
  passThroughUsd: number;
  /** Both together — the figure the records want. */
  totalUsd: number;
  /** Of `ownCostUsd`, how much came from a provider's own API. */
  measuredUsd: number;
  /** Lines with no figure at all. The total is understated by these. */
  unavailable: CostAccountId[];
  /** Declared lines nobody has confirmed lately. */
  stale: CostAccountId[];
}

export function summarize(lines: readonly CostLine[], now: Date): CostSummary {
  let ownCostUsd = 0;
  let passThroughUsd = 0;
  let measuredUsd = 0;
  const unavailable: CostAccountId[] = [];
  const stale: CostAccountId[] = [];

  for (const line of lines) {
    const account = accountFor(line.accountId);
    if (!account) continue;
    if (line.amountUsd === null) {
      // A free account with no figure is not a gap; there is nothing to find.
      if (account.provenance !== 'free') unavailable.push(account.id);
      continue;
    }
    if (isStale(line, now)) stale.push(account.id);
    // A domain declared at zero because Route 53 already bills it is the
    // expected case, and adding zero twice is harmless. A non-zero one is the
    // operator saying it is billed separately, so it counts.
    if (account.passThrough) passThroughUsd += line.amountUsd;
    else {
      ownCostUsd += line.amountUsd;
      if (account.provenance === 'measured') measuredUsd += line.amountUsd;
    }
  }

  return {
    ownCostUsd: round2(ownCostUsd),
    passThroughUsd: round2(passThroughUsd),
    totalUsd: round2(ownCostUsd + passThroughUsd),
    measuredUsd: round2(measuredUsd),
    unavailable,
    stale,
  };
}

/**
 * Below this much of the month elapsed, a projection is arithmetic rather than
 * evidence — two days of spend times fifteen is a rumour.
 */
export const PROJECTION_MIN_ELAPSED = 0.1;

export interface MonthProgress {
  /** 0 to 1, how much of the current month has passed. */
  elapsed: number;
  daysElapsed: number;
  daysInMonth: number;
}

export function monthProgress(now: Date): MonthProgress {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = Date.UTC(year, month, 1);
  const end = Date.UTC(year, month + 1, 1);
  const elapsed = (now.getTime() - start) / (end - start);
  return {
    elapsed: Math.min(1, Math.max(0, elapsed)),
    daysElapsed: Math.floor((now.getTime() - start) / 86_400_000),
    daysInMonth: Math.round((end - start) / 86_400_000),
  };
}

/**
 * Month-to-date spend, extended to month end.
 *
 * Returns null early in the month rather than a confident wrong number. The
 * whole point of this figure is deciding whether there is enough in the
 * account, and a projection built on two days invites the wrong answer in
 * whichever direction those two days leaned.
 */
export function projectMonthEnd(monthToDateUsd: number, now: Date): number | null {
  const { elapsed } = monthProgress(now);
  if (elapsed < PROJECTION_MIN_ELAPSED) return null;
  return round2(monthToDateUsd / elapsed);
}

/**
 * The sentence at the top of the page.
 *
 * Deliberately refuses to lead with a number it cannot stand behind: if a
 * provider could not be reached, the total is an understatement and saying so
 * matters more than the total does.
 */
export function cashHeadline(summary: CostSummary, projected: number | null, now: Date): string {
  if (summary.unavailable.length > 0) {
    const names = summary.unavailable
      .map((id) => accountFor(id)?.label ?? id)
      .join(' and ');
    return `At least $${summary.ownCostUsd.toFixed(2)} this month — ${names} could not be reached, so the real figure is higher.`;
  }
  if (projected === null) {
    const { daysElapsed } = monthProgress(now);
    return `$${summary.ownCostUsd.toFixed(2)} so far. ${daysElapsed} day${daysElapsed === 1 ? '' : 's'} in is too early to project the month.`;
  }
  return `About $${projected.toFixed(2)} to have ready this month. $${summary.ownCostUsd.toFixed(2)} of it has been billed so far.`;
}

/**
 * Money in, for the same period.
 *
 * Events and prints are kept apart on purpose. They are not the same kind of
 * revenue: an event sale is margin, while a print sale is priced to net about
 * ten cents on a photo print (see `prints.ts`) and exists as a convenience.
 * Adding them gives a revenue figure that grows when a guest orders a $12.66
 * print and makes the business look like it earned $12.66.
 */
export interface PeriodRevenue {
  /** Events, add-ons and subscriptions, gross. */
  eventsUsd: number;
  /** Print orders, gross — most of which is Prodigi's and Stripe's. */
  printsUsd: number;
  /** Committed back to customers, from the refund ledger. */
  refundedUsd: number;
}

export function grossRevenue(revenue: PeriodRevenue): number {
  return round2(revenue.eventsUsd + revenue.printsUsd);
}

export interface ProfitAndLoss {
  grossUsd: number;
  refundedUsd: number;
  /** Stripe fees and Prodigi's bill: real costs, funded by the sale itself. */
  passThroughUsd: number;
  /** AWS, Cloudflare, mailboxes, domain: owed whether or not anything sells. */
  ownCostUsd: number;
  /** What is left. Negative is the normal answer before there is volume. */
  netUsd: number;
  /**
   * False when a provider could not be reached, so `netUsd` is optimistic.
   *
   * A P&L that silently omits a cost reads as a better month than happened,
   * and this is the number somebody would file.
   */
  complete: boolean;
}

export function profitAndLoss(revenue: PeriodRevenue, summary: CostSummary): ProfitAndLoss {
  const grossUsd = grossRevenue(revenue);
  const netUsd =
    grossUsd - revenue.refundedUsd - summary.passThroughUsd - summary.ownCostUsd;
  return {
    grossUsd,
    refundedUsd: round2(revenue.refundedUsd),
    passThroughUsd: summary.passThroughUsd,
    ownCostUsd: summary.ownCostUsd,
    netUsd: round2(netUsd),
    complete: summary.unavailable.length === 0,
  };
}

/** The bottom line, in a sentence, hedged exactly as far as the data deserves. */
export function netHeadline(pl: ProfitAndLoss): string {
  const magnitude = `$${Math.abs(pl.netUsd).toFixed(2)}`;
  const direction = pl.netUsd >= 0 ? `Net ${magnitude}` : `Down ${magnitude}`;
  if (pl.grossUsd === 0 && pl.ownCostUsd === 0) return 'Nothing in, nothing out.';
  if (!pl.complete) return `${direction}, but at least one cost is missing — the real figure is worse.`;
  return `${direction} on $${pl.grossUsd.toFixed(2)} in.`;
}

/**
 * What a costs page cannot tell you.
 *
 * The same device as the monthly report's NOT_MEASURED list, for the same
 * reason: the gaps are invisible unless something names them, and a total that
 * silently omits a category is worse than one that admits to it.
 */
export const COSTS_NOT_COVERED: readonly string[] = [
  'Anything bought outside these accounts — contractors, hardware, software subscriptions on a personal card',
  'Tax owed. The service is not taxable in Minnesota; prints are an open question — see docs/mn-print-tax-request.md',
  'Chargebacks and Stripe disputes — no dispute data comes back from Stripe yet',
  'Money owed but not yet paid: research rewards awaiting fulfilment are in the monthly report',
  'What next month will cost if usage changes. This projects the current month only',
  'This is a cash view, not accounting. Nothing here is depreciated, accrued, or fit to file as-is',
];

function round2(usd: number): number {
  return Math.round(usd * 100) / 100;
}
