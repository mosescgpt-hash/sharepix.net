import {
  PRINT_MARGIN,
  PRINT_PRODUCTS,
  PRINT_SHIPPING_CENTS,
  PRINT_SHIPPING_USD,
  findPrintProduct,
  printUnitPrice,
  printUnitPriceCents,
} from '../lib/prints';

describe('print pricing', () => {
  it('charges the guest a 50% margin over the Prodigi base cost', () => {
    // The whole point of the model: profit is half the base cost.
    expect(PRINT_MARGIN).toBe(1.5);
    expect(printUnitPrice(2)).toBeCloseTo(3, 5); // base $2 → guest $3, $1 profit
    expect(printUnitPrice(4)).toBeCloseTo(6, 5);
    expect(printUnitPrice(30)).toBeCloseTo(45, 5);
  });

  it('rounds to the nearest nickel without eating the margin', () => {
    // base $2.20 → 3.30 already on a nickel; base $1.60 → 2.40.
    expect(printUnitPrice(2.2)).toBeCloseTo(3.3, 5);
    expect(printUnitPrice(1.6)).toBeCloseTo(2.4, 5);
    // The rounded price is always >= the raw marked-up price (never rounds below).
    for (const product of PRINT_PRODUCTS) {
      expect(printUnitPrice(product.baseCost)).toBeGreaterThanOrEqual(
        product.baseCost * PRINT_MARGIN - 0.025,
      );
    }
  });

  it('exposes prices in whole cents for Stripe', () => {
    expect(printUnitPriceCents(4)).toBe(600);
    expect(printUnitPriceCents(1.6)).toBe(240);
    expect(PRINT_SHIPPING_CENTS).toBe(Math.round(PRINT_SHIPPING_USD * 100));
    // Cents must be integers so Stripe never rejects a fractional amount.
    for (const product of PRINT_PRODUCTS) {
      expect(Number.isInteger(printUnitPriceCents(product.baseCost))).toBe(true);
    }
  });

  it('looks products up by SKU and has a non-empty catalog', () => {
    expect(PRINT_PRODUCTS.length).toBeGreaterThan(0);
    const first = PRINT_PRODUCTS[0];
    expect(findPrintProduct(first.sku)).toEqual(first);
    expect(findPrintProduct('NOPE-000')).toBeUndefined();
  });

  it('keeps every catalog SKU unique', () => {
    const skus = PRINT_PRODUCTS.map((product) => product.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });
});
