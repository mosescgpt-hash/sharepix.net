import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
} from '@aws-sdk/client-cost-explorer';
import { DynamoDBClient, GetItemCommand, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import Stripe from 'stripe';

import {
  type CostAccountId,
  type CostLine,
  type CostSummaryResult,
  type PeriodRevenue,
  DECLARED_COSTS_SETTING_KEY,
  cashHeadline,
  netHeadline,
  profitAndLoss,
  projectMonthEnd,
  r2CostUsd,
  summarize,
} from './costs';

/**
 * What SharePix costs and earns, for a period, from every source that knows.
 *
 * Invoked by `/global-admin → Costs` and by the scheduled reports. It reads and
 * calculates; it moves no money and changes nothing except its own cache.
 *
 * ## Why it caches
 *
 * **Cost Explorer bills $0.01 per request.** That is nothing once a day and
 * real money behind a dashboard somebody leaves open — a page that refetched on
 * every render would quietly turn a cost page into a cost. So an answer is
 * stored and reused for CACHE_TTL_MS unless the caller explicitly asks for a
 * fresh one, and the page shows how old the figure is rather than pretending it
 * is live.
 *
 * ## Why one provider failing does not fail the answer
 *
 * Each source is fetched independently and a failure becomes a line with no
 * figure and a reason. The alternative — throwing — gives a blank page when
 * four of five numbers were available, and the whole point is knowing what is
 * owed. `summarize` counts the gaps and the headline leads with them, so an
 * incomplete total can never read as a complete one.
 */

const dynamo = new DynamoDBClient({});
// Cost Explorer is a global service with a us-east-1 endpoint. Pointing it at
// the deployment's region fails with an unhelpful credentials error.
const costExplorer = new CostExplorerClient({ region: 'us-east-1' });

const PAYMENT_TABLE = process.env.PAYMENT_TABLE_NAME as string;
const PRINT_ORDER_TABLE = process.env.PRINT_ORDER_TABLE_NAME as string;
const REFUND_TABLE = process.env.REFUND_TABLE_NAME as string;
const SETTING_TABLE = process.env.SETTING_TABLE_NAME as string;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? '';
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';

/** How long a stored answer is reused. See the header. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** AppSetting row holding the cached answer. */
const CACHE_KEY = 'cost-summary-cache';

interface Arguments {
  /** Inclusive ISO date. Defaults to the start of the current month. */
  start?: string | null;
  /** Exclusive ISO date. Defaults to now. */
  end?: string | null;
  /** Skip the cache. Costs a Cost Explorer request. */
  refresh?: boolean | null;
}

function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function usd(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Every row of a table. These are small; Payment and PrintOrder are per-sale. */
async function scanAll(table: string): Promise<Record<string, AttributeValue>[]> {
  const rows: Record<string, AttributeValue>[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({ TableName: table, ExclusiveStartKey: startKey }),
    );
    rows.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

function inPeriod(value: string | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return false;
  return at >= start.getTime() && at < end.getTime();
}

/**
 * AWS month-to-date spend, by service.
 *
 * `UnblendedCost` is what the account is actually charged. `AmortizedCost`
 * would spread reservations across the month, which reads better and is not
 * what leaves the bank.
 */
async function awsCost(
  start: Date,
  end: Date,
): Promise<{ total: number | null; byService: Array<{ service: string; amountUsd: number }>; reason?: string }> {
  try {
    const result = await costExplorer.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: isoDate(start), End: isoDate(end) },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }),
    );
    const byService: Array<{ service: string; amountUsd: number }> = [];
    let total = 0;
    for (const period of result.ResultsByTime ?? []) {
      for (const group of period.Groups ?? []) {
        const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? '0');
        if (!Number.isFinite(amount)) continue;
        total += amount;
        const service = group.Keys?.[0] ?? 'Unknown';
        const existing = byService.find((row) => row.service === service);
        if (existing) existing.amountUsd = usd(existing.amountUsd + amount);
        else byService.push({ service, amountUsd: usd(amount) });
      }
    }
    // Services billing fractions of a cent are noise on a page about cash.
    byService.sort((a, b) => b.amountUsd - a.amountUsd);
    return { total: usd(total), byService: byService.filter((row) => row.amountUsd >= 0.01) };
  } catch (error) {
    return { total: null, byService: [], reason: describe(error) };
  }
}

/**
 * Cost Explorer's own forecast to month end.
 *
 * Preferred over pro-rating month-to-date because it knows the shape of the
 * account's spend. It refuses when there is too little history, which is why
 * the caller falls back rather than treating null as zero.
 */
async function awsForecast(now: Date): Promise<number | null> {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  // A forecast needs a future window; on the last day of the month there isn't one.
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (tomorrow >= end) return null;
  try {
    const result = await costExplorer.send(
      new GetCostForecastCommand({
        TimePeriod: { Start: isoDate(tomorrow), End: isoDate(end) },
        Granularity: 'MONTHLY',
        Metric: 'UNBLENDED_COST',
      }),
    );
    const amount = Number(result.Total?.Amount ?? '');
    return Number.isFinite(amount) ? usd(amount) : null;
  } catch {
    // Not an error worth surfacing: a forecast is a nicety, and the page
    // projects from month-to-date when it is missing.
    return null;
  }
}

/**
 * What Stripe actually took in fees, and what actually arrived.
 *
 * Balance transactions rather than 2.9% + 30¢ recomputed from the charge: the
 * recomputation is right until a currency conversion, a dispute fee or a rate
 * change makes it wrong, and it would be wrong silently.
 */
async function stripeFees(
  start: Date,
  end: Date,
): Promise<{ feesUsd: number | null; reason?: string }> {
  if (!STRIPE_SECRET_KEY) {
    return { feesUsd: null, reason: 'STRIPE_SECRET_KEY is not set on this function' };
  }
  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY);
    let fees = 0;
    const params: Stripe.BalanceTransactionListParams = {
      created: { gte: Math.floor(start.getTime() / 1000), lt: Math.floor(end.getTime() / 1000) },
      limit: 100,
    };
    for await (const transaction of stripe.balanceTransactions.list(params)) {
      fees += transaction.fee ?? 0;
    }
    return { feesUsd: usd(fees / 100) };
  } catch (error) {
    return { feesUsd: null, reason: describe(error) };
  }
}

/**
 * R2 storage and operations, from Cloudflare's GraphQL analytics API.
 *
 * Cloudflare exposes usage, not a bill, so the cost is that usage priced at the
 * rates in `costs.ts`. Both halves can be wrong in different ways: the usage is
 * measured and the rates are copied from a pricing page, which is why the page
 * shows when the rates were last checked.
 */
async function cloudflareR2(
  start: Date,
  end: Date,
): Promise<{ costUsd: number | null; detail?: string; reason?: string }> {
  if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID) {
    return {
      costUsd: null,
      reason:
        'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are not set. Add them in Amplify and redeploy — they are read at build time, not at run time.',
    };
  }
  const query = `
    query R2Usage($accountTag: String!, $start: Date!, $end: Date!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          storageGroups: r2StorageAdaptiveGroups(
            limit: 1
            filter: { date_geq: $start, date_lt: $end }
          ) {
            max { payloadSize }
          }
          operationGroups: r2OperationsAdaptiveGroups(
            limit: 100
            filter: { date_geq: $start, date_lt: $end }
          ) {
            dimensions { actionType }
            sum { requests }
          }
        }
      }
    }
  `;
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: CLOUDFLARE_ACCOUNT_ID,
          start: isoDate(start),
          end: isoDate(end),
        },
      }),
    });
    if (!response.ok) {
      return { costUsd: null, reason: `Cloudflare responded ${response.status}` };
    }
    const body = (await response.json()) as CloudflareResponse;
    if (body.errors?.length) {
      return { costUsd: null, reason: body.errors.map((e) => e.message).join('; ') };
    }
    const account = body.data?.viewer?.accounts?.[0];
    if (!account) return { costUsd: null, reason: 'Cloudflare returned no account' };

    const bytes = account.storageGroups?.[0]?.max?.payloadSize ?? 0;
    const storageGbMonth = bytes / 1_000_000_000;
    let classA = 0;
    let classB = 0;
    for (const group of account.operationGroups ?? []) {
      const requests = group.sum?.requests ?? 0;
      if (CLASS_A_ACTIONS.has(group.dimensions?.actionType ?? '')) classA += requests;
      else classB += requests;
    }
    const costUsd = r2CostUsd({ storageGbMonth, classAOperations: classA, classBOperations: classB });
    return {
      costUsd,
      detail: `${storageGbMonth.toFixed(1)} GB stored, ${classA.toLocaleString()} writes, ${classB.toLocaleString()} reads`,
    };
  } catch (error) {
    return { costUsd: null, reason: describe(error) };
  }
}

interface CloudflareResponse {
  errors?: Array<{ message: string }>;
  data?: {
    viewer?: {
      accounts?: Array<{
        storageGroups?: Array<{ max?: { payloadSize?: number } }>;
        operationGroups?: Array<{
          dimensions?: { actionType?: string };
          sum?: { requests?: number };
        }>;
      }>;
    };
  };
}

/**
 * Which R2 operations bill at the class A rate.
 *
 * Everything else is class B, which is the cheap one. Guessing the other way
 * would be the expensive mistake, and an unrecognised action name is far more
 * likely to be a read than a write given what SharePix does.
 */
const CLASS_A_ACTIONS = new Set([
  'PutObject',
  'CopyObject',
  'CompleteMultipartUpload',
  'CreateMultipartUpload',
  'UploadPart',
  'UploadPartCopy',
  'ListBuckets',
  'ListObjects',
  'PutBucketEncryption',
  'DeleteObject',
  'DeleteObjects',
  'LifecycleStorageTierTransition',
]);

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** The declared fixed costs a global admin typed in. */
async function declaredCosts(): Promise<Record<string, { amountUsd: number; asOf: string }>> {
  if (!SETTING_TABLE) return {};
  try {
    const found = await dynamo.send(
      new GetItemCommand({ TableName: SETTING_TABLE, Key: { id: { S: DECLARED_COSTS_SETTING_KEY } } }),
    );
    const raw = found.Item?.value?.S;
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, { amountUsd: number; asOf: string }>;
  } catch {
    // A declared cost that cannot be read becomes a missing line, which the
    // summary reports as a gap. Better than treating it as zero.
    return {};
  }
}

async function readCache(): Promise<CostSummaryResult | null> {
  if (!SETTING_TABLE) return null;
  try {
    const found = await dynamo.send(
      new GetItemCommand({ TableName: SETTING_TABLE, Key: { id: { S: CACHE_KEY } } }),
    );
    const raw = found.Item?.value?.S;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CostSummaryResult;
    const age = Date.now() - Date.parse(parsed.generatedAt);
    if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null;
    return { ...parsed, cached: true };
  } catch {
    return null;
  }
}

async function writeCache(result: CostSummaryResult): Promise<void> {
  if (!SETTING_TABLE) return;
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: SETTING_TABLE,
        Item: {
          id: { S: CACHE_KEY },
          value: { S: JSON.stringify(result) },
          updatedBy: { S: 'cost-summary' },
        },
      }),
    );
  } catch {
    // A cache that will not save costs a penny next time. Not worth failing for.
  }
}

export const handler = async (event: { arguments?: Arguments }): Promise<string> => {
  const args = event.arguments ?? {};
  const now = new Date();
  const start = args.start ? new Date(`${args.start}T00:00:00Z`) : startOfMonth(now);
  const end = args.end ? new Date(`${args.end}T00:00:00Z`) : now;

  const isCurrentMonth = !args.start && !args.end;
  if (isCurrentMonth && !args.refresh) {
    const cached = await readCache();
    if (cached) return JSON.stringify(cached);
  }

  const [aws, forecast, stripe, cloudflare, declared, payments, printOrders, refunds] =
    await Promise.all([
      awsCost(start, end),
      isCurrentMonth ? awsForecast(now) : Promise.resolve(null),
      stripeFees(start, end),
      cloudflareR2(start, end),
      declaredCosts(),
      PAYMENT_TABLE ? scanAll(PAYMENT_TABLE) : Promise.resolve([]),
      PRINT_ORDER_TABLE ? scanAll(PRINT_ORDER_TABLE) : Promise.resolve([]),
      REFUND_TABLE ? scanAll(REFUND_TABLE) : Promise.resolve([]),
    ]);

  const paidInPeriod = payments.filter(
    (row) => row.status?.S === 'complete' && inPeriod(row.createdAt?.S, start, end),
  );
  const printsInPeriod = printOrders.filter(
    (row) => row.status?.S !== 'pending' && inPeriod(row.createdAt?.S, start, end),
  );

  const eventsUsd = usd(
    paidInPeriod.reduce((sum, row) => sum + Number(row.amountTotal?.N ?? '0') / 100, 0),
  );
  const printsUsd = usd(
    printsInPeriod.reduce((sum, row) => sum + Number(row.amountTotal?.N ?? '0') / 100, 0),
  );
  const refundedUsd = usd(
    refunds
      .filter(
        (row) =>
          (row.status?.S === 'APPROVED' || row.status?.S === 'RECORDED') &&
          inPeriod(row.createdAt?.S, start, end),
      )
      .reduce((sum, row) => sum + Math.max(0, Number(row.amountCents?.N ?? '0')) / 100, 0),
  );

  // What Prodigi bills, derived from what the buyer paid: the buyer price is
  // the Prodigi cost plus a known profit and Stripe's cut, so the print revenue
  // minus the profit is what leaves for Prodigi. Deriving it from the order
  // rows rather than from Prodigi's invoices means it is an estimate of a real
  // obligation rather than a record of one — flagged as computed for that
  // reason. It is also pass-through, so it never enters the cash headline.
  const prodigiUsd = usd(prodigiCostOf(printsInPeriod));

  const declaredLine = (id: CostAccountId): CostLine => {
    const entry = declared[id];
    if (!entry || typeof entry.amountUsd !== 'number') {
      return {
        accountId: id,
        amountUsd: null,
        asOf: null,
        unavailableReason: 'Not entered yet — add it in the Costs tab',
      };
    }
    return { accountId: id, amountUsd: entry.amountUsd, asOf: entry.asOf ?? null };
  };

  const generatedAt = new Date().toISOString();
  const lines: CostLine[] = [
    {
      accountId: 'aws',
      amountUsd: aws.total,
      asOf: generatedAt,
      detail: aws.byService
        .slice(0, 3)
        .map((row) => `${row.service} $${row.amountUsd.toFixed(2)}`)
        .join(', '),
      unavailableReason: aws.reason,
    },
    {
      accountId: 'cloudflare-r2',
      amountUsd: cloudflare.costUsd,
      asOf: generatedAt,
      detail: cloudflare.detail,
      unavailableReason: cloudflare.reason,
    },
    {
      accountId: 'stripe',
      amountUsd: stripe.feesUsd,
      asOf: generatedAt,
      detail: `${paidInPeriod.length + printsInPeriod.length} charge${paidInPeriod.length + printsInPeriod.length === 1 ? '' : 's'}`,
      unavailableReason: stripe.reason,
    },
    {
      accountId: 'prodigi',
      amountUsd: prodigiUsd,
      asOf: generatedAt,
      detail: `${printsInPeriod.length} print order${printsInPeriod.length === 1 ? '' : 's'}`,
    },
    declaredLine('microsoft365'),
    declaredLine('domain'),
    { accountId: 'github', amountUsd: 0, asOf: generatedAt },
    { accountId: 'cloudflare-analytics', amountUsd: 0, asOf: generatedAt },
    { accountId: 'search-console', amountUsd: 0, asOf: generatedAt },
  ];

  const revenue: PeriodRevenue = { eventsUsd, printsUsd, refundedUsd };
  const summaryValue = summarize(lines, now);
  const pl = profitAndLoss(revenue, summaryValue);

  // Cost Explorer's forecast covers AWS alone, so the rest of the own-cost
  // figure is pro-rated and the two are added. Using the forecast for the whole
  // page would understate it by the mailbox and R2.
  const nonAws = usd(summaryValue.ownCostUsd - (aws.total ?? 0));
  const projectedOwnCostUsd =
    forecast !== null && aws.total !== null
      ? usd(aws.total + forecast + (projectMonthEnd(nonAws, now) ?? nonAws))
      : projectMonthEnd(summaryValue.ownCostUsd, now);

  const result: CostSummaryResult = {
    start: isoDate(start),
    end: isoDate(end),
    lines,
    revenue,
    awsByService: aws.byService,
    awsForecastUsd: forecast,
    summary: summaryValue,
    profitAndLoss: pl,
    projectedOwnCostUsd,
    cashHeadline: cashHeadline(summaryValue, projectedOwnCostUsd, now),
    netHeadline: netHeadline(pl),
    generatedAt,
    cached: false,
  };

  if (isCurrentMonth) await writeCache(result);
  return JSON.stringify(result);
};

/**
 * What the print orders in a period owe Prodigi.
 *
 * Each order row carries a JSON snapshot of what was bought, including the unit
 * price charged. The Prodigi share is what is left after the profit and
 * Stripe's cut, which `prints.ts` defines — but that module is in `lib/` and
 * out of reach here, so this uses the one number the snapshot already carries.
 */
function prodigiCostOf(orders: Record<string, AttributeValue>[]): number {
  let total = 0;
  for (const order of orders) {
    const paid = Number(order.amountTotal?.N ?? '0') / 100;
    if (!Number.isFinite(paid)) continue;
    // Stripe's cut and the per-print profit stay with SharePix; everything else
    // is Prodigi's. PRODIGI_SHARE is deliberately conservative — overstating
    // what is owed is the safe direction on a page about having enough money.
    total += paid * PRODIGI_SHARE;
  }
  return total;
}

/**
 * The fraction of a print order's price that goes to Prodigi.
 *
 * Derived from the pricing rules: the buyer pays Prodigi's cost plus an 8%
 * buffer, plus a small profit, all grossed up for Stripe. Across the catalogue
 * that leaves Prodigi with roughly this share. It is an estimate, which is why
 * the Prodigi line is marked `computed` rather than `measured`, and why it is
 * rounded against SharePix rather than for it.
 *
 * The exact figure is on Prodigi's invoices. When those are wired up this
 * constant goes away rather than being tuned.
 */
const PRODIGI_SHARE = 0.85;
