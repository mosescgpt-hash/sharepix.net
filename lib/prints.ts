/**
 * Print-on-demand catalog + pricing.
 *
 * Guests and hosts order prints of an event's photos through Prodigi. The buyer
 * pays the Prodigi base cost plus a per-print profit, plus shipping at Prodigi's
 * real cost (first item + a "plus-one" charge per additional item).
 *
 * Profit per print (SharePix's margin) follows these rules:
 *   - Target 50% of the Prodigi base cost, but
 *   - never less than PRINT_MIN_PROFIT — enough that even the cheapest single
 *     print clears Stripe's fixed fee, so an order never loses money — and
 *   - never more than PRINT_MAX_PROFIT ($10), unless the print's base cost is
 *     over PRINT_HIGH_BASE ($100), where the cap rises to PRINT_MAX_PROFIT_HIGH
 *     ($20).
 *
 * The profit above is the NET target. The buyer price grosses it up by Stripe's
 * percentage fee (STRIPE_PCT) so the profit survives the fee — i.e. the buyer
 * transparently covers card processing. Shipping is Prodigi's real cost, passed
 * straight through; SharePix's margin lives only in the per-print profit.
 *
 * All values are USD for US fulfilment (Prodigi "made in USA", Standard tracked
 * shipping), pulled from the Prodigi US price sheet. This file is the single
 * source of truth; the checkout Lambda keeps its own inlined copy (Amplify
 * functions avoid cross-bundle imports), so update both together.
 */

/** Target profit as a fraction of base (before the floor/cap clamp). */
export const PRINT_MARGIN_TARGET = 0.5;
/** Minimum profit per print, so a single cheap print never loses money on fees. */
export const PRINT_MIN_PROFIT = 1.5;
/** Maximum profit per print for a normal print. */
export const PRINT_MAX_PROFIT = 10;
/** Base cost above which a print counts as "expensive" and the cap rises. */
export const PRINT_HIGH_BASE = 100;
/** Maximum profit per print when the base cost is over PRINT_HIGH_BASE. */
export const PRINT_MAX_PROFIT_HIGH = 20;
/** Stripe's percentage fee, grossed into the price so profit lands net of it. */
export const STRIPE_PCT = 0.029;

export interface PrintProduct {
  /** Prodigi catalogue SKU (US made). */
  sku: string;
  /** Short product label shown to buyers (e.g. "Photo print"). */
  name: string;
  /** Human-readable size (e.g. "4×6 in"). */
  size: string;
  /** Prodigi base cost per copy, USD. */
  baseCost: number;
  /** Prodigi Standard shipping for the first item to the US, USD. */
  shipFirst: number;
  /** Prodigi "plus-one" shipping per additional item in the same order, USD. */
  shipAdd: number;
}

// From the Prodigi US price sheet (made-in-USA, Standard tracked shipping).
// C-Type photo prints ship extras free (shipAdd 0); framed adds per-item.
export const PRINT_PRODUCTS: PrintProduct[] = [
  { sku: 'GLOBAL-PHO-4X6', name: 'Photo print', size: '4×6 in', baseCost: 0.15, shipFirst: 8.95, shipAdd: 0 },
  { sku: 'GLOBAL-PHO-5X7', name: 'Photo print', size: '5×7 in', baseCost: 0.65, shipFirst: 8.95, shipAdd: 0 },
  { sku: 'GLOBAL-PHO-8X10', name: 'Photo print', size: '8×10 in', baseCost: 2.0, shipFirst: 9.95, shipAdd: 0 },
  { sku: 'GLOBAL-FAP-11X14', name: 'Fine-art print', size: '11×14 in', baseCost: 12.0, shipFirst: 9.95, shipAdd: 0 },
  { sku: 'GLOBAL-CFP-12X16', name: 'Framed print', size: '12×16 in', baseCost: 39.0, shipFirst: 20.0, shipAdd: 12.0 },
];

/**
 * Net profit per print in USD (what SharePix keeps after Stripe's percentage
 * fee): 50% of base, clamped to [min, cap] (cap depends on base).
 */
export function printProfit(baseCost: number): number {
  const cap = baseCost > PRINT_HIGH_BASE ? PRINT_MAX_PROFIT_HIGH : PRINT_MAX_PROFIT;
  const target = baseCost * PRINT_MARGIN_TARGET;
  return Math.min(cap, Math.max(PRINT_MIN_PROFIT, target));
}

/**
 * Buyer price per copy in USD: (base + net profit) grossed up by Stripe's
 * percentage fee so the profit lands net of it, then rounded to the nearest
 * $0.05. The gross-up has the buyer cover card processing.
 */
export function printUnitPrice(baseCost: number): number {
  const grossed = (baseCost + printProfit(baseCost)) / (1 - STRIPE_PCT);
  return Math.round(grossed * 20) / 20;
}

/** Buyer price per copy in whole cents, for Stripe line items. */
export function printUnitPriceCents(baseCost: number): number {
  return Math.round(printUnitPrice(baseCost) * 100);
}

/**
 * Shipping charged for an order of `totalCopies` of one product, USD: Prodigi's
 * first-item shipping + plus-one for each additional item. Pure pass-through —
 * SharePix's margin lives in the per-print profit, not in shipping.
 */
export function printShipping(product: PrintProduct, totalCopies: number): number {
  const extras = Math.max(0, totalCopies - 1);
  return product.shipFirst + product.shipAdd * extras;
}

/** Shipping in whole cents, for the Stripe shipping option. */
export function printShippingCents(product: PrintProduct, totalCopies: number): number {
  return Math.round(printShipping(product, totalCopies) * 100);
}

export function findPrintProduct(sku: string): PrintProduct | undefined {
  return PRINT_PRODUCTS.find((product) => product.sku === sku);
}
