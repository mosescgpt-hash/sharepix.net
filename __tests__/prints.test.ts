import {
  PRINT_MAX_PROFIT,
  PRINT_MAX_PROFIT_HIGH,
  PRINT_MIN_PROFIT,
  PRINT_PRODUCTS,
  STRIPE_PCT,
  findPrintProduct,
  printProfit,
  printShipping,
  printUnitPrice,
  printUnitPriceCents,
} from '../lib/prints';

describe('print profit rules', () => {
  it('targets 50% of base between the floor and the cap', () => {
    expect(printProfit(12)).toBeCloseTo(6, 5); // $12 base → $6 profit
    expect(printProfit(8)).toBeCloseTo(4, 5);
  });

  it('never drops below the minimum profit (so cheap prints do not lose money)', () => {
    expect(printProfit(0.15)).toBe(PRINT_MIN_PROFIT); // 50% would be $0.075
    expect(printProfit(0.65)).toBe(PRINT_MIN_PROFIT);
    for (const product of PRINT_PRODUCTS) {
      expect(printProfit(product.baseCost)).toBeGreaterThanOrEqual(PRINT_MIN_PROFIT);
    }
  });

  it('caps profit at $10 for a normal print', () => {
    expect(printProfit(39)).toBe(PRINT_MAX_PROFIT); // 50% would be $19.50
    expect(printProfit(100)).toBe(PRINT_MAX_PROFIT); // exactly $100 is not "over"
    for (const product of PRINT_PRODUCTS) {
      expect(printProfit(product.baseCost)).toBeLessThanOrEqual(PRINT_MAX_PROFIT);
    }
  });

  it('caps profit at $20 only when the base cost is over $100', () => {
    expect(printProfit(101)).toBe(PRINT_MAX_PROFIT_HIGH); // 50% would be $50.50
    expect(printProfit(300)).toBe(PRINT_MAX_PROFIT_HIGH);
  });

  it('grosses the price up for Stripe so the net profit survives the fee', () => {
    // (base + profit) / (1 - 2.9%), nickel-rounded.
    expect(printUnitPrice(12)).toBeCloseTo(18.55, 2); // (12 + 6) / 0.971
    expect(printUnitPrice(39)).toBeCloseTo(50.45, 2); // (39 + 10) / 0.971
    for (const product of PRINT_PRODUCTS) {
      expect(Number.isInteger(printUnitPriceCents(product.baseCost))).toBe(true);
    }
  });

  it('recovers close to the target net profit after the percentage fee', () => {
    for (const product of PRINT_PRODUCTS) {
      const afterPct = printUnitPrice(product.baseCost) * (1 - STRIPE_PCT) - product.baseCost;
      // Within a nickel of the target (rounding), and never short of it.
      expect(afterPct).toBeGreaterThanOrEqual(printProfit(product.baseCost) - 0.05);
    }
  });
});

describe('print shipping (pure Prodigi pass-through)', () => {
  const photo = findPrintProduct('GLOBAL-PHO-8X10')!;
  const framed = findPrintProduct('GLOBAL-CFP-12X16')!;

  it('charges Prodigi first-item shipping with no markup', () => {
    expect(printShipping(photo, 1)).toBeCloseTo(photo.shipFirst, 5);
  });

  it('ships additional photo prints free (plus-one is $0)', () => {
    expect(printShipping(photo, 5)).toBeCloseTo(printShipping(photo, 1), 5);
  });

  it('charges plus-one shipping for each extra framed print', () => {
    expect(printShipping(framed, 3)).toBeCloseTo(framed.shipFirst + framed.shipAdd * 2, 5);
  });
});

describe('no order loses money after Stripe fees', () => {
  // Even the single cheapest print must net positive after Stripe's 2.9% + $0.30.
  it.each(PRINT_PRODUCTS.map((p) => [p.sku, p]))('%s, one copy', (_sku, product) => {
    const p = product as (typeof PRINT_PRODUCTS)[number];
    const buyerPays = printUnitPrice(p.baseCost) + printShipping(p, 1);
    const prodigiCost = p.baseCost + p.shipFirst;
    const stripeFee = buyerPays * 0.029 + 0.3;
    expect(buyerPays - prodigiCost - stripeFee).toBeGreaterThan(0);
  });
});

describe('print catalog', () => {
  it('looks products up by SKU and is non-empty', () => {
    expect(PRINT_PRODUCTS.length).toBeGreaterThan(0);
    const first = PRINT_PRODUCTS[0];
    expect(findPrintProduct(first.sku)).toEqual(first);
    expect(findPrintProduct('NOPE-000')).toBeUndefined();
  });

  it('keeps every SKU unique', () => {
    const skus = PRINT_PRODUCTS.map((product) => product.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });
});
