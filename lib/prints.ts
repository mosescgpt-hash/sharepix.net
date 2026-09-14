/**
 * Print-on-demand catalog + pricing.
 *
 * Guests and hosts order prints of an event's photos through Prodigi. The buyer
 * pays the Prodigi base cost plus a per-print profit, plus shipping.
 *
 * ## What the buyer covers
 *
 * SharePix must never be out of pocket on a print order, so the buyer price has
 * to cover three things, not two: Prodigi's bill, Stripe's **percentage** fee,
 * and Stripe's **fixed** fee. The last one was missed for a long time and is
 * the reason small orders would have lost money — $0.30 is trivial against a
 * framed print and a fifth of the margin on a 4×6. Caught before the first
 * order rather than after it, which is the only reason it cost nothing.
 *
 * The percentage and the fixed fee behave differently, so they are recovered
 * differently:
 *
 *   - **Percentage** applies to every dollar the buyer pays, including
 *     shipping. So every line is grossed up by `1 / (1 - STRIPE_PCT)` — the
 *     print price *and* the shipping line.
 *   - **Fixed** is charged once per *charge*, not per print. So it is recovered
 *     once, on the shipping line, where the other per-order cost already lives.
 *
 * Everything Prodigi bills also carries PRODIGI_SAFETY, a buffer against their
 * prices moving between checks.
 *
 * Put together, an order of `n` copies charges
 *
 *     (prodigiCost × (1 + PRODIGI_SAFETY) + profit × n + STRIPE_FIXED)
 *       / (1 - STRIPE_PCT)
 *
 * which nets `profit × n` plus the unused buffer after Stripe takes its cut.
 * Rounding is always **up**, to the nearest cent — nickel rounding was a real
 * surcharge on a 39¢ print and grew with every copy.
 *
 * ## Profit per print
 *
 * Photo prints (4×6, 5×7, 8×10) earn a flat PHOTO_PRINT_PROFIT — a few cents,
 * deliberately. They exist as a convenience for guests, not as a margin line,
 * and the shipping dwarfs them anyway.
 *
 * Fine-art and framed prints follow the margin rule in `printProfit`: target
 * 50% of base, never below PRINT_MIN_PROFIT, never above PRINT_MAX_PROFIT
 * ($10) unless base is over PRINT_HIGH_BASE ($100), where the cap rises to
 * PRINT_MAX_PROFIT_HIGH ($20).
 *
 * ## Where the numbers come from
 *
 * All values are USD for US fulfilment (Prodigi "made in USA", Standard tracked
 * shipping). They are **Prodigi's live quoted prices**, not a printed price
 * sheet — see PRICES_VERIFIED_ON.
 *
 * Nothing in this repository can check them: the only source of truth is
 * Prodigi, and the only thing that asks is `/global-admin → Print check`, which
 * compares its quote against this file and says so when they disagree. A unit
 * test cannot, because a test comparing this file to itself always passes —
 * which is exactly how these numbers went stale before.
 *
 * This file is the single source of truth in the app; the checkout Lambda keeps
 * its own inlined copy (Amplify functions avoid cross-bundle imports), so
 * update both together.
 */

/** Date the costs below were last confirmed against a live Prodigi quote. */
export const PRICES_VERIFIED_ON = '2026-09-14';

/** Target profit as a fraction of base, for fine-art and framed prints. */
export const PRINT_MARGIN_TARGET = 0.5;
/** Minimum profit per print under the margin rule. */
export const PRINT_MIN_PROFIT = 1.5;
/** Maximum profit per print for a normal print. */
export const PRINT_MAX_PROFIT = 10;
/** Base cost above which a print counts as "expensive" and the cap rises. */
export const PRINT_HIGH_BASE = 100;
/** Maximum profit per print when the base cost is over PRINT_HIGH_BASE. */
export const PRINT_MAX_PROFIT_HIGH = 20;
/** Stripe's percentage fee, grossed into every line the buyer pays. */
export const STRIPE_PCT = 0.029;
/** Stripe's fixed per-charge fee, recovered once per order. */
export const STRIPE_FIXED = 0.3;

/**
 * Safety margin added to everything Prodigi bills, as a fraction.
 *
 * A buffer against Prodigi raising prices between checks, so an increase costs
 * SharePix nothing before anyone notices. Not a margin — it is expected to go
 * unused, and when it stops being unused the answer is to update the catalog,
 * not to keep it.
 *
 * It applies to the **whole Prodigi bill**, base cost and shipping alike,
 * because a price rise hits both and the exposure is simply proportional to
 * what Prodigi charges. Which line dominates depends entirely on the order: a
 * single 4×6 is 98% shipping, so its risk is all there; fifty 8×10s are mostly
 * print cost, so theirs is not. A buffer on shipping alone left that second
 * case with almost no cover.
 *
 * Proportional is also the fair shape. A flat per-print surcharge large enough
 * to protect a $12 single order would add nearly 50% to a 25-print order —
 * penalising exactly the buyers the modal encourages to order more. A
 * percentage of cost charges each order in proportion to the risk it actually
 * carries.
 *
 * The smaller the detection gap, the smaller this needs to be. The weekly check
 * in `daily-tasks` is the better half of the pair, and the reason 8% is enough:
 * it covers a Prodigi increase of the size they announced in July 2026, with
 * room for the days before the check reports it.
 */
export const PRODIGI_SAFETY = 0.08;

/**
 * Profit on a photo print. Near zero on purpose: prints are offered as a
 * convenience, and anything more would be invisible next to the shipping.
 */
export const PHOTO_PRINT_PROFIT = 0.1;

/** Which pricing rule a product follows. */
export type PrintKind = 'photo' | 'premium';

export interface PrintProduct {
  /** Prodigi catalogue SKU (US made). */
  sku: string;
  /** Short product label shown to buyers (e.g. "Photo print"). */
  name: string;
  /** Human-readable size (e.g. "4×6 in"). */
  size: string;
  /** Flat-profit convenience print, or margin-rule premium print. */
  kind: PrintKind;
  /** Prodigi base cost per copy, USD. */
  baseCost: number;
  /** Prodigi Standard shipping for the first item to the US, USD. */
  shipFirst: number;
  /** Prodigi "plus-one" shipping per additional item in the same order, USD. */
  shipAdd: number;
}

// Every number here is a Prodigi live quote as of PRICES_VERIFIED_ON,
// shipAdd included — the print check quotes two copies to measure it, since a
// one-copy quote cannot see it at all.
//
// That measurement found the framed print's plus-one at $11.00 where this file
// had inherited $12.00, so every extra framed print had been overcharged by a
// dollar. Worth noting the direction: drift is not always in SharePix's favour
// to ignore. The four cheaper products' $0 plus-one was confirmed, which is
// what the order modal's "shipping is charged per order" nudge rests on.
export const PRINT_PRODUCTS: PrintProduct[] = [
  { sku: 'GLOBAL-PHO-4X6', name: 'Photo print', size: '4×6 in', kind: 'photo', baseCost: 0.25, shipFirst: 10.75, shipAdd: 0 },
  { sku: 'GLOBAL-PHO-5X7', name: 'Photo print', size: '5×7 in', kind: 'photo', baseCost: 0.5, shipFirst: 10.75, shipAdd: 0 },
  { sku: 'GLOBAL-PHO-8X10', name: 'Photo print', size: '8×10 in', kind: 'photo', baseCost: 2.0, shipFirst: 11.85, shipAdd: 0 },
  { sku: 'GLOBAL-FAP-11X14', name: 'Fine-art print', size: '11×14 in', kind: 'premium', baseCost: 14.0, shipFirst: 11.85, shipAdd: 0 },
  { sku: 'GLOBAL-CFP-12X16', name: 'Framed print', size: '12×16 in', kind: 'premium', baseCost: 40.0, shipFirst: 24.8, shipAdd: 11.0 },
];

/**
 * Round up to a multiple of `step`.
 *
 * Always up: rounding down by even a cent turns a $0.10 margin into $0.09, and
 * the epsilon keeps a value that is already an exact multiple from being pushed
 * to the next one by float noise.
 */
function ceilTo(usd: number, step: number): number {
  return Math.round(Math.ceil(usd / step - 1e-9) * step * 100) / 100;
}

/**
 * The margin rule for premium prints: 50% of base, clamped to [min, cap].
 *
 * Photo prints do not use this — see `profitFor`, which is what pricing calls.
 */
export function printProfit(baseCost: number): number {
  const cap = baseCost > PRINT_HIGH_BASE ? PRINT_MAX_PROFIT_HIGH : PRINT_MAX_PROFIT;
  const target = baseCost * PRINT_MARGIN_TARGET;
  return Math.min(cap, Math.max(PRINT_MIN_PROFIT, target));
}

/** Net profit SharePix intends to keep on one copy of `product`, USD. */
export function profitFor(product: PrintProduct): number {
  return product.kind === 'photo' ? PHOTO_PRINT_PROFIT : printProfit(product.baseCost);
}

/**
 * Buyer price per copy in USD: base plus its safety margin, plus profit,
 * grossed up for Stripe's percentage fee and rounded **up** to the cent.
 *
 * Stripe's fixed fee is not here — it is a per-order cost and is recovered once,
 * on the shipping line.
 */
export function printUnitPrice(product: PrintProduct): number {
  const cost = product.baseCost * (1 + PRODIGI_SAFETY);
  return ceilTo((cost + profitFor(product)) / (1 - STRIPE_PCT), 0.01);
}

/** Buyer price per copy in whole cents, for Stripe line items. */
export function printUnitPriceCents(product: PrintProduct): number {
  return Math.round(printUnitPrice(product) * 100);
}

/**
 * What Prodigi bills SharePix for shipping an order of `totalCopies`, USD:
 * first-item shipping plus a plus-one charge for each additional item.
 */
export function prodigiShippingCost(product: PrintProduct, totalCopies: number): number {
  const extras = Math.max(0, totalCopies - 1);
  return product.shipFirst + product.shipAdd * extras;
}

/**
 * What the buyer is charged for shipping and handling, USD: Prodigi's cost plus
 * a safety margin, plus Stripe's fixed fee, the whole thing grossed up for
 * Stripe's percentage.
 *
 * Not a pass-through, and the UI must not call it one. Charging Prodigi's cost
 * exactly still lost money — Stripe takes 2.9% of the shipping the buyer paid
 * and $0.30 of the order on top — and charging it exactly would leave nothing
 * for the day Prodigi's own shipping goes up.
 */
export function printShipping(product: PrintProduct, totalCopies: number): number {
  const prodigi = prodigiShippingCost(product, totalCopies) * (1 + PRODIGI_SAFETY);
  return ceilTo((prodigi + STRIPE_FIXED) / (1 - STRIPE_PCT), 0.01);
}

/** Shipping in whole cents, for the Stripe shipping option. */
export function printShippingCents(product: PrintProduct, totalCopies: number): number {
  return Math.round(printShipping(product, totalCopies) * 100);
}

/** Total the buyer pays for `totalCopies` of one product, USD. */
export function printOrderTotal(product: PrintProduct, totalCopies: number): number {
  return printUnitPrice(product) * totalCopies + printShipping(product, totalCopies);
}

/**
 * Delivered cost per print, USD — the total divided by the number of prints.
 *
 * This is the number that makes the case for ordering more than one: shipping
 * is mostly per-order, so it falls fast. A single 4×6 is most of $12; ten are
 * about $1.50 each.
 */
export function deliveredPricePerPrint(product: PrintProduct, totalCopies: number): number {
  if (totalCopies <= 0) return 0;
  return printOrderTotal(product, totalCopies) / totalCopies;
}

/** Look up a catalog product by its Prodigi SKU. */
export function findPrintProduct(sku: string): PrintProduct | undefined {
  return PRINT_PRODUCTS.find((product) => product.sku === sku);
}
