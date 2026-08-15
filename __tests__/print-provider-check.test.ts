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
