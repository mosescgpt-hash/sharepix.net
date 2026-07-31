/**
 * Print-on-demand catalog + pricing.
 *
 * Guests order prints of an event's photos through Prodigi. The guest pays the
 * Prodigi base cost × PRINT_MARGIN; the margin (50% of base) is SharePix's
 * profit. Shipping is charged on top as a flat per-order fee.
 *
 * `baseCost` is Prodigi's per-copy cost in USD and is the single source of truth
 * for pricing — the checkout function prices Stripe line items from these
 * numbers and the UI shows the same ones. The checkout Lambda keeps its own
 * inlined copy of this map (Amplify functions avoid cross-bundle imports), so
 * update both together.
 *
 * IMPORTANT: reconcile `sku` and `baseCost` against the live Prodigi price list
 * (https://dashboard.prodigi.com) before going live, and keep each `baseCost`
 * at or above Prodigi's real cost so the 50% margin is never eaten.
 */

/** Guest pays base × this. 1.5 → 50% profit on Prodigi's base cost. */
export const PRINT_MARGIN = 1.5;

/** Flat per-order shipping charged to the guest, in USD. */
export const PRINT_SHIPPING_USD = 6.99;

export interface PrintProduct {
  /** Prodigi catalogue SKU. Verify against the live Prodigi price list. */
  sku: string;
  /** Short product label shown to guests (e.g. "Photo print"). */
  name: string;
  /** Human-readable size (e.g. "6×4 in"). */
  size: string;
  /** Prodigi base cost per copy, in USD. */
  baseCost: number;
}

export const PRINT_PRODUCTS: PrintProduct[] = [
  { sku: 'GLOBAL-PHO-6X4', name: 'Photo print', size: '6×4 in', baseCost: 1.6 },
  { sku: 'GLOBAL-PHO-7X5', name: 'Photo print', size: '7×5 in', baseCost: 2.2 },
  { sku: 'GLOBAL-PHO-10X8', name: 'Photo print', size: '10×8 in', baseCost: 4.0 },
  { sku: 'GLOBAL-CAN-16X12', name: 'Canvas', size: '16×12 in', baseCost: 24.0 },
  { sku: 'GLOBAL-FAP-16X12', name: 'Framed print', size: '16×12 in', baseCost: 30.0 },
];

/**
 * Guest-facing price per copy in USD: base × margin, rounded to the nearest
 * $0.05 so line items stay tidy. The margin is preserved because rounding is to
 * the nearest nickel on an already-marked-up number.
 */
export function printUnitPrice(baseCost: number): number {
  return Math.round(baseCost * PRINT_MARGIN * 20) / 20;
}

/** Guest-facing price per copy in whole cents, for Stripe line items. */
export function printUnitPriceCents(baseCost: number): number {
  return Math.round(printUnitPrice(baseCost) * 100);
}

/** Flat shipping in whole cents, for the Stripe shipping option. */
export const PRINT_SHIPPING_CENTS = Math.round(PRINT_SHIPPING_USD * 100);

export function findPrintProduct(sku: string): PrintProduct | undefined {
  return PRINT_PRODUCTS.find((product) => product.sku === sku);
}
