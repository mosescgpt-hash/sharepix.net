import type { Schema } from '../../data/resource';

type Handler = Schema['checkPrintProvider']['functionHandler'];

/**
 * Quote one copy of every print we sell.
 *
 * Prodigi's `/v4.0/quotes` prices an order without creating one: nothing is
 * printed, nothing is charged, no order id exists afterwards. That makes it the
 * one call that can prove — for free, against the live account — that
 *
 *   1. the live API key authenticates (a wrong-environment key answers 401),
 *   2. Lambda can actually reach api.prodigi.com (a blocked egress path times
 *      out here exactly as it would during fulfilment), and
 *   3. every SKU and its required attributes are valid in the live catalogue.
 *
 * What it deliberately does NOT prove: order-create validation and Prodigi's
 * fetch of the signed asset URL. Those run only on a real order. The code that
 * builds that request is the same code already proven in sandbox across all
 * five sizes — only the base URL and key differ, and both are what this checks.
 */

// Mirrors print-fulfill's PRODUCT_ATTRIBUTES and lib/prints.ts's catalogue. Kept
// in sync by hand so this function has no cross-bundle imports (same convention
// as print-checkout's PRINT_PRODUCTS). If they drift, this check passes while
// fulfilment fails — the one thing it exists to catch.
//
// `baseCost` and `shipFirst` are what lib/prints.ts charges against, so the
// quote can be compared with them. `shipAdd` is the plus-one shipping, which a
// one-copy quote cannot see at all: it is measured by quoting two copies.
const PRODUCTS: {
  sku: string;
  label: string;
  attributes: Record<string, string>;
  baseCost: number;
  shipFirst: number;
  shipAdd: number;
}[] = [
  { sku: 'GLOBAL-PHO-4X6', label: '4×6 photo print', attributes: { finish: 'lustre' }, baseCost: 0.25, shipFirst: 10.75, shipAdd: 0 },
  { sku: 'GLOBAL-PHO-5X7', label: '5×7 photo print', attributes: { finish: 'lustre' }, baseCost: 0.5, shipFirst: 10.75, shipAdd: 0 },
  { sku: 'GLOBAL-PHO-8X10', label: '8×10 photo print', attributes: { finish: 'lustre' }, baseCost: 2.0, shipFirst: 11.85, shipAdd: 0 },
  { sku: 'GLOBAL-FAP-11X14', label: '11×14 fine-art print', attributes: {}, baseCost: 14.0, shipFirst: 11.85, shipAdd: 0 },
  { sku: 'GLOBAL-CFP-12X16', label: '12×16 framed print', attributes: { color: 'black' }, baseCost: 40.0, shipFirst: 24.8, shipAdd: 11.0 },
];

/** Cents of disagreement tolerated before a price counts as drifted. */
const PRICE_TOLERANCE = 0.005;

// Same shipping method and destination the real orders use, so a quote exercises
// the same product/shipping combination fulfilment will ask for.
const SHIPPING_METHOD = 'Standard';
const DESTINATION_COUNTRY = 'US';
const CURRENCY = 'USD';

const REQUEST_TIMEOUT_MS = 15000;

interface Money {
  amount?: string;
  currency?: string;
}

interface QuoteResponse {
  outcome?: string;
  quotes?: {
    costSummary?: { items?: Money; shipping?: Money };
  }[];
}

function prodigiBaseUrl(): string {
  return process.env.PRODIGI_ENV === 'live'
    ? 'https://api.prodigi.com'
    : 'https://api.sandbox.prodigi.com';
}

interface CheckLine {
  ok: boolean;
  text: string;
  status?: number;
  /** Which way a drifted price moved: see `comparison`. */
  direction?: 'under' | 'over';
}

interface Quote {
  /** Prodigi's total for the items in the quote (all copies), USD. */
  items: number;
  /** Prodigi's shipping for the whole quote, USD. */
  shipping: number;
}

type QuoteResult = { ok: true; quote: Quote; elapsed: number } | { ok: false; line: CheckLine };

function amount(value: Money | undefined): number | null {
  const parsed = Number(value?.amount);
  return Number.isFinite(parsed) ? parsed : null;
}

async function quoteProduct(
  product: (typeof PRODUCTS)[number],
  apiKey: string,
  copies: number,
): Promise<QuoteResult> {
  const body = {
    shippingMethod: SHIPPING_METHOD,
    destinationCountryCode: DESTINATION_COUNTRY,
    currencyCode: CURRENCY,
    items: [
      {
        sku: product.sku,
        copies,
        attributes: product.attributes,
        // A quote needs the print area but no asset URL — nothing is fetched.
        assets: [{ printArea: 'default' }],
      },
    ],
  };

  let response: Response;
  const startedAt = Date.now();
  try {
    response = await fetch(`${prodigiBaseUrl()}/v4.0/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout here is the same failure fulfilment would hit: Lambda cannot
    // reach Prodigi at all.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      line: { ok: false, text: `${product.label} (${product.sku}) — no response: ${reason}` },
    };
  }

  const elapsed = Date.now() - startedAt;

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    return {
      ok: false,
      line: {
        ok: false,
        status: response.status,
        text: `${product.label} (${product.sku}) — HTTP ${response.status}: ${detail || '(no body)'}`,
      },
    };
  }

  const data = (await response.json().catch(() => null)) as QuoteResponse | null;
  const quote = data?.quotes?.[0];
  const items = amount(quote?.costSummary?.items);
  const shipping = amount(quote?.costSummary?.shipping);
  if (items === null || shipping === null) {
    return {
      ok: false,
      line: {
        ok: false,
        status: response.status,
        text: `${product.label} (${product.sku}) — no usable quote (outcome: ${data?.outcome ?? 'unknown'})`,
      },
    };
  }

  return { ok: true, quote: { items, shipping }, elapsed };
}

/**
 * `$1.23`, or `$1.23 (code says $4.56)` when the two disagree.
 *
 * `under` means the code charges against a cost lower than Prodigi's, so
 * SharePix eats the difference. `over` means the opposite: the buyer is being
 * charged for a cost Prodigi no longer has. Both are wrong and only one of them
 * is expensive, which is exactly why the direction has to be reported — the
 * first version of this said "losing money on every one" whatever had moved,
 * and the first real drift it found was an overcharge.
 */
function comparison(
  actual: number,
  expected: number,
): { text: string; drifted: boolean; direction: 'under' | 'over' | null } {
  const drifted = Math.abs(actual - expected) > PRICE_TOLERANCE;
  const shown = `$${actual.toFixed(2)}`;
  return {
    drifted,
    direction: !drifted ? null : expected < actual ? 'under' : 'over',
    text: drifted ? `${shown} (code says $${expected.toFixed(2)})` : shown,
  };
}

/**
 * Quote one product at one copy and at two, and compare all three numbers the
 * pricing depends on: base cost, first-item shipping, and the plus-one shipping
 * that only a second copy reveals.
 */
async function checkProduct(
  product: (typeof PRODUCTS)[number],
  apiKey: string,
): Promise<CheckLine> {
  const single = await quoteProduct(product, apiKey, 1);
  if (!single.ok) return single.line;

  const double = await quoteProduct(product, apiKey, 2);
  if (!double.ok) return double.line;

  const base = comparison(single.quote.items, product.baseCost);
  const ship = comparison(single.quote.shipping, product.shipFirst);
  // Two copies cost first-item shipping plus exactly one plus-one charge.
  const plusOne = comparison(double.quote.shipping - single.quote.shipping, product.shipAdd);

  const checks = [base, ship, plusOne];
  const drifted = checks.some((check) => check.drifted);
  const parts = [
    `${base.text} print`,
    `${ship.text} shipping`,
    `${plusOne.text} per extra`,
  ].join(' + ');

  return {
    ok: !drifted,
    status: 200,
    // Undercharging is the more expensive mistake, so it wins when a product
    // has drifted both ways at once.
    direction: checks.some((c) => c.direction === 'under')
      ? 'under'
      : checks.some((c) => c.direction === 'over')
        ? 'over'
        : undefined,
    text: `${product.label} (${product.sku}) — ${parts} ${CURRENCY} (${single.elapsed}ms)`,
  };
}

export const handler: Handler = async () => {
  const apiKey = process.env.PRODIGI_API_KEY;
  const env = process.env.PRODIGI_ENV === 'live' ? 'LIVE' : 'SANDBOX';
  const host = prodigiBaseUrl().replace('https://', '');

  if (!apiKey) {
    return {
      success: false,
      message: `PRODIGI_API_KEY is not set on the print-provider-check function, so ${env} could not be contacted at all. Set the secret and redeploy.`,
    };
  }

  // Sequential on purpose: ten parallel calls would report one shared failure
  // ten times and make a rate-limit response look like five broken SKUs.
  const lines: CheckLine[] = [];
  for (const product of PRODUCTS) {
    lines.push(await checkProduct(product, apiKey));
  }

  const passed = lines.filter((line) => line.ok).length;
  const authFailed = lines.some((line) => line.status === 401 || line.status === 403);
  const drifted = lines.filter((line) => !line.ok && line.status === 200).length;
  const header = `Prodigi ${env} (${host}) — ${passed} of ${lines.length} products match the prices in the code.`;

  const notes: string[] = [];
  if (authFailed) {
    notes.push(
      `The key was rejected. A sandbox key returns 401 against ${host} — check PRODIGI_API_KEY is the ${env} key.`,
    );
  }
  if (drifted > 0) {
    const under = lines.filter((line) => line.direction === 'under').length;
    const over = lines.filter((line) => line.direction === 'over').length;
    const consequence = [
      under > 0
        ? `${under} charge${under === 1 ? 's' : ''} against a cost lower than Prodigi's, so SharePix pays the difference — on the cheap sizes that is a loss on every order.`
        : '',
      over > 0
        ? `${over} charge${over === 1 ? 's' : ''} the buyer for a cost Prodigi no longer has, so customers are being overcharged.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    notes.push(
      `${drifted} product${drifted === 1 ? "'s price has" : "s' prices have"} moved. ${consequence} Update PRINT_PRODUCTS in lib/prints.ts AND the copies in print-checkout and this function, then redeploy.`,
    );
  }
  if (passed === lines.length) {
    notes.push(
      'Credentials, network path, every SKU and every price are good. Nothing was ordered or charged.',
    );
  }

  const message = [header, '', ...lines.map((l) => `${l.ok ? '✓' : '✗'} ${l.text}`), '', ...notes]
    .join('\n')
    .trim();

  console.log('Print provider check', {
    at: new Date().toISOString(),
    env,
    passed,
    drifted,
    total: lines.length,
  });

  return { success: passed === lines.length, message };
};
