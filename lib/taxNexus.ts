/**
 * When it is time to stop handling sales tax yourself.
 *
 * ## What this is for
 *
 * Stripe Tax now calculates and collects, but it does not register, file or
 * remit — those stay a person's job. That is fine at low volume and stops being
 * fine at a threshold, and the failure mode is not noticing you crossed one.
 * Tax authorities do not send a warning; the liability accrues quietly and is
 * discovered later, with interest.
 *
 * So this is a tripwire, not an accounting system. It watches the sales we have
 * already recorded and says "the situation you were told to watch for has
 * happened". What to do about it is a conversation with an accountant, and
 * possibly a move to a merchant of record — which costs about 2.4% of revenue
 * and is the reason it is a trigger rather than something done up front.
 *
 * ## The two triggers, and why they are different shapes
 *
 * **Any sale outside the US** fires immediately, on the first one. EU VAT on
 * digital services has NO threshold — the liability starts at the first euro —
 * so a count-based rule would be wrong by design. This is the trigger that
 * actually justifies a merchant of record.
 *
 * **US state nexus** fires on approach rather than on arrival, because
 * registering takes weeks and the point is to act before the obligation lands.
 *
 * ## These numbers are a guide, not the law
 *
 * $100,000 or 200 transactions is the COMMON economic-nexus threshold, and
 * several states differ: some have dropped the transaction count, some use
 * $500,000, and a few use different measurement periods. Physical presence
 * creates nexus regardless of any number — which is why a home state is a
 * registration you need whatever this file says.
 *
 * Treated as a prompt to check, never as a verdict. Every message this produces
 * says so, and nothing here decides anything on its own.
 */

/** The common US economic-nexus sales threshold, in dollars. */
export const US_NEXUS_SALES_USD = 100_000;

/** The common US economic-nexus transaction-count threshold. */
export const US_NEXUS_TRANSACTIONS = 200;

/**
 * How close to a threshold is close enough to say something.
 *
 * Registering with a state takes weeks, so a tripwire that fires on arrival
 * fires too late to be useful. Eighty per cent leaves room to act.
 */
export const NEXUS_WARN_FRACTION = 0.8;

/** Where the business is registered. Nexus there exists regardless of volume. */
export const HOME_JURISDICTION_NOTE =
  'Physical presence creates nexus on its own, so your home state needs a registration whatever these numbers say.';

/** One completed sale, reduced to what nexus depends on. */
export interface NexusSale {
  /** ISO 3166-1 alpha-2, uppercase. Empty when Stripe recorded no address. */
  country?: string | null;
  /** State or province code, for US sales. */
  region?: string | null;
  /** Charged amount in cents. */
  amountCents?: number | null;
}

export interface JurisdictionTotals {
  jurisdiction: string;
  transactions: number;
  salesUsd: number;
  /** Past the common threshold on either measure. */
  overThreshold: boolean;
  /** Within NEXUS_WARN_FRACTION of either measure. */
  approaching: boolean;
}

export interface NexusAssessment {
  /** True when any sale was made outside the US. */
  hasInternationalSales: boolean;
  internationalCountries: string[];
  /** US states at or near a threshold, worst first. */
  jurisdictions: JurisdictionTotals[];
  /** Sales Stripe recorded no address for. They cannot be attributed. */
  unknownJurisdictionSales: number;
  /** True when anything here is worth a person's attention. */
  actionNeeded: boolean;
}

function usd(cents: number | null | undefined): number {
  const value = Number(cents ?? 0);
  return Number.isFinite(value) && value > 0 ? value / 100 : 0;
}

/**
 * Where the sales recorded so far put us.
 *
 * Counts only what it was given. This is deliberately not clever about
 * refunds, date windows or marketplace rules — a tripwire that quietly
 * excluded things would be worse than one that occasionally says "look at
 * this" when the answer turns out to be fine.
 */
export function assessNexus(sales: NexusSale[] | null | undefined): NexusAssessment {
  const rows = Array.isArray(sales) ? sales : [];
  const byState = new Map<string, { transactions: number; salesUsd: number }>();
  const countries = new Set<string>();
  let unknown = 0;

  for (const sale of rows) {
    const country = (sale.country ?? '').trim().toUpperCase();
    if (!country) {
      // No address means no jurisdiction. Counted and reported rather than
      // guessed at or dropped, because a pile of these means the address is
      // not being captured and the whole assessment is understated.
      unknown += 1;
      continue;
    }
    if (country !== 'US') {
      countries.add(country);
      continue;
    }
    const region = (sale.region ?? '').trim().toUpperCase();
    if (!region) {
      unknown += 1;
      continue;
    }
    const current = byState.get(region) ?? { transactions: 0, salesUsd: 0 };
    current.transactions += 1;
    current.salesUsd += usd(sale.amountCents);
    byState.set(region, current);
  }

  const jurisdictions: JurisdictionTotals[] = [];
  for (const [jurisdiction, totals] of byState) {
    const overThreshold =
      totals.salesUsd >= US_NEXUS_SALES_USD || totals.transactions >= US_NEXUS_TRANSACTIONS;
    const approaching =
      totals.salesUsd >= US_NEXUS_SALES_USD * NEXUS_WARN_FRACTION ||
      totals.transactions >= US_NEXUS_TRANSACTIONS * NEXUS_WARN_FRACTION;
    if (!overThreshold && !approaching) continue;
    jurisdictions.push({ jurisdiction, ...totals, overThreshold, approaching });
  }
  // Worst first: over the line before merely approaching, then by size.
  jurisdictions.sort((a, b) => {
    if (a.overThreshold !== b.overThreshold) return a.overThreshold ? -1 : 1;
    return b.salesUsd - a.salesUsd;
  });

  const internationalCountries = [...countries].sort();
  return {
    hasInternationalSales: internationalCountries.length > 0,
    internationalCountries,
    jurisdictions,
    unknownJurisdictionSales: unknown,
    actionNeeded: internationalCountries.length > 0 || jurisdictions.length > 0,
  };
}

/**
 * What to tell the operator, in plain words.
 *
 * Returns an empty array when there is nothing to say, so a caller can render
 * nothing rather than "no tax issues", which invites being read as advice.
 */
export function nexusMessages(assessment: NexusAssessment): string[] {
  const messages: string[] = [];
  if (assessment.hasInternationalSales) {
    messages.push(
      `Sales outside the US (${assessment.internationalCountries.join(', ')}). ` +
        'EU VAT on digital services has no threshold — the obligation starts at the first sale. ' +
        'This is the point at which a merchant of record is usually worth its fee.',
    );
  }
  for (const row of assessment.jurisdictions) {
    const detail = `${row.transactions} sale${row.transactions === 1 ? '' : 's'}, $${Math.round(row.salesUsd).toLocaleString()}`;
    messages.push(
      row.overThreshold
        ? `${row.jurisdiction} is past the common economic-nexus threshold (${detail}). Check the state's own rule and register if it applies.`
        : `${row.jurisdiction} is approaching the common economic-nexus threshold (${detail}). Registering takes weeks, so it is worth starting now.`,
    );
  }
  if (assessment.unknownJurisdictionSales > 0) {
    messages.push(
      `${assessment.unknownJurisdictionSales} sale${assessment.unknownJurisdictionSales === 1 ? '' : 's'} had no address recorded, so ` +
        'they are not counted above and these totals are understated.',
    );
  }
  return messages;
}

/**
 * The sentence that has to accompany any of the above.
 *
 * A tripwire that reads like advice is worse than no tripwire: it invites
 * someone to act on a rule of thumb that several states do not follow.
 */
export const NEXUS_DISCLAIMER =
  'Thresholds vary by state and change. This is a prompt to check with an accountant, not tax advice.';
