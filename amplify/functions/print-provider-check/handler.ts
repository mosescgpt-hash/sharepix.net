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
const PRODUCTS: { sku: string; label: string; attributes: Record<string, string> }[] = [
  { sku: 'GLOBAL-PHO-4X6', label: '4×6 photo print', attributes: { finish: 'lustre' } },
  { sku: 'GLOBAL-PHO-5X7', label: '5×7 photo print', attributes: { finish: 'lustre' } },
  { sku: 'GLOBAL-PHO-8X10', label: '8×10 photo print', attributes: { finish: 'lustre' } },
  { sku: 'GLOBAL-FAP-11X14', label: '11×14 fine-art print', attributes: {} },
  { sku: 'GLOBAL-CFP-12X16', label: '12×16 framed print', attributes: { color: 'black' } },
];

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

function money(value: Money | undefined): string {
  if (!value?.amount) return '?';
  return `$${value.amount}`;
}

interface CheckLine {
  ok: boolean;
  text: string;
  status?: number;
}

async function quoteProduct(
  product: (typeof PRODUCTS)[number],
  apiKey: string,
): Promise<CheckLine> {
  const body = {
    shippingMethod: SHIPPING_METHOD,
    destinationCountryCode: DESTINATION_COUNTRY,
    currencyCode: CURRENCY,
    items: [
      {
        sku: product.sku,
        copies: 1,
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
    return { ok: false, text: `${product.label} (${product.sku}) — no response: ${reason}` };
  }

  const elapsed = Date.now() - startedAt;

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    return {
      ok: false,
      status: response.status,
      text: `${product.label} (${product.sku}) — HTTP ${response.status}: ${detail || '(no body)'}`,
    };
  }

  const data = (await response.json().catch(() => null)) as QuoteResponse | null;
  const quote = data?.quotes?.[0];
  if (!quote) {
    return {
      ok: false,
      status: response.status,
      text: `${product.label} (${product.sku}) — no quote returned (outcome: ${data?.outcome ?? 'unknown'})`,
    };
  }

  const items = money(quote.costSummary?.items);
  const shipping = money(quote.costSummary?.shipping);
  return {
    ok: true,
    status: response.status,
    text: `${product.label} (${product.sku}) — ${items} + ${shipping} shipping ${CURRENCY} (${elapsed}ms)`,
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

  // Sequential on purpose: five parallel calls would report one shared failure
  // five times and make a rate-limit response look like five broken SKUs.
  const lines: CheckLine[] = [];
  for (const product of PRODUCTS) {
    lines.push(await quoteProduct(product, apiKey));
  }

  const passed = lines.filter((line) => line.ok).length;
  const authFailed = lines.some((line) => line.status === 401 || line.status === 403);
  const header = `Prodigi ${env} (${host}) — ${passed} of ${lines.length} products quoted.`;

  const notes: string[] = [];
  if (authFailed) {
    notes.push(
      `The key was rejected. A sandbox key returns 401 against ${host} — check PRODIGI_API_KEY is the ${env} key.`,
    );
  }
  if (passed === lines.length) {
    notes.push('Credentials, network path and every SKU are good. Nothing was ordered or charged.');
  }

  const message = [header, '', ...lines.map((l) => `${l.ok ? '✓' : '✗'} ${l.text}`), '', ...notes]
    .join('\n')
    .trim();

  console.log('Print provider check', { at: new Date().toISOString(), env, passed, total: lines.length });

  return { success: passed === lines.length, message };
};
