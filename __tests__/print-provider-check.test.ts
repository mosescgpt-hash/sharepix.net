import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRINT_PRODUCTS } from '../lib/prints';

/**
 * The print-provider check quotes each SKU with the same attributes fulfilment
 * will send. Those tables are duplicated by hand (the functions deliberately
 * have no cross-bundle imports), and drift between them is the one failure the
 * check cannot report: it would quote a product nobody can order, or skip the
 * one that is broken. So the source of both is compared here.
 */
const root = join(__dirname, '..');
const checkSource = readFileSync(
  join(root, 'amplify/functions/print-provider-check/handler.ts'),
  'utf8',
);
const fulfillSource = readFileSync(
  join(root, 'amplify/functions/print-fulfill/handler.ts'),
  'utf8',
);
const checkoutSource = readFileSync(
  join(root, 'amplify/functions/print-checkout/handler.ts'),
  'utf8',
);

/**
 * Every place a Prodigi cost is written down.
 *
 * There are three, because Amplify functions cannot import from `lib/`: the
 * catalog in lib/prints.ts, the copy print-checkout prices from, and the copy
 * the provider check compares its quotes against. They must agree, and the
 * consequence of disagreeing is not abstract — the storefront would quote one
 * price, Stripe would charge another, and the check would call it all fine.
 */
function costsIn(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const entry = /'?(GLOBAL-[A-Z0-9-]+)'?[^\n]*?baseCost:\s*([\d.]+),\s*shipFirst:\s*([\d.]+),\s*shipAdd:\s*([\d.]+)/g;
  for (const m of source.matchAll(entry)) {
    found.set(m[1], [Number(m[2]), Number(m[3]), Number(m[4])].map((n) => n.toFixed(2)).join('/'));
  }
  return found;
}

function catalogCosts(): Map<string, string> {
  return new Map(
    PRINT_PRODUCTS.map((p) => [
      p.sku,
      [p.baseCost, p.shipFirst, p.shipAdd].map((n) => n.toFixed(2)).join('/'),
    ]),
  );
}

/** `{ finish: 'lustre' }` and `{finish:"lustre"}` are the same table. */
function normalizeAttributes(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/"/g, "'");
}

function checkedProducts(): Map<string, string> {
  const found = new Map<string, string>();
  const entry = /\{\s*sku:\s*'([^']+)',[^}]*attributes:\s*(\{[^}]*\})/g;
  for (const match of checkSource.matchAll(entry)) {
    found.set(match[1], normalizeAttributes(match[2]));
  }
  return found;
}

function fulfilledAttributes(): Map<string, string> {
  // Only the PRODUCT_ATTRIBUTES table, not every brace in the file.
  const start = fulfillSource.indexOf('const PRODUCT_ATTRIBUTES');
  const body = fulfillSource.slice(start, fulfillSource.indexOf('};', start));
  const found = new Map<string, string>();
  for (const match of body.matchAll(/'([A-Z0-9-]+)':\s*(\{[^}]*\})/g)) {
    found.set(match[1], normalizeAttributes(match[2]));
  }
  return found;
}

describe('the three copies of Prodigi\'s prices agree', () => {
  // This is the guard that did not exist when it was needed. Every base cost in
  // the catalog was wrong against Prodigi for months, and the only test that
  // looked at pricing compared the catalog to itself, so it stayed green while
  // small orders lost money on every sale.
  //
  // This cannot check the prices are *right* — only Prodigi knows that, and only
  // the admin print check asks. It checks they are the *same*, which is the half
  // a test can actually own.
  it('parsed a cost table out of both functions', () => {
    expect(costsIn(checkoutSource).size).toBe(PRINT_PRODUCTS.length);
    expect(costsIn(checkSource).size).toBe(PRINT_PRODUCTS.length);
  });

  it('matches lib/prints.ts in print-checkout, which is what the buyer is charged', () => {
    expect(Object.fromEntries(costsIn(checkoutSource))).toEqual(
      Object.fromEntries(catalogCosts()),
    );
  });

  it('matches lib/prints.ts in the provider check, which is what raises the alarm', () => {
    expect(Object.fromEntries(costsIn(checkSource))).toEqual(Object.fromEntries(catalogCosts()));
  });
});

describe('print provider check stays in sync with what it is checking', () => {
  it('parsed both tables (the regexes still match the source)', () => {
    expect(checkedProducts().size).toBeGreaterThan(0);
    expect(fulfilledAttributes().size).toBeGreaterThan(0);
  });

  it('quotes every SKU the storefront sells', () => {
    const checked = [...checkedProducts().keys()].sort();
    const sold = PRINT_PRODUCTS.map((p) => p.sku).sort();
    expect(checked).toEqual(sold);
  });

  it('quotes each SKU with the attributes fulfilment sends', () => {
    const fulfilled = fulfilledAttributes();
    for (const [sku, attributes] of checkedProducts()) {
      // A SKU missing from fulfilment's table is ordered with no attributes.
      expect([sku, attributes]).toEqual([sku, fulfilled.get(sku) ?? '{}']);
    }
  });

  it('uses the quotes endpoint, never Orders — a real order would be charged', () => {
    expect(checkSource).toContain('/v4.0/quotes');
    expect(checkSource).not.toContain('/v4.0/Orders');
  });
});
