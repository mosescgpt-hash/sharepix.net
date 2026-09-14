import {
  PHOTO_PRINT_PROFIT,
  PRINT_MAX_PROFIT,
  PRINT_MAX_PROFIT_HIGH,
  PRINT_MIN_PROFIT,
  PRINT_PRODUCTS,
  STRIPE_FIXED,
  STRIPE_PCT,
  deliveredPricePerPrint,
  findPrintProduct,
  printOrderTotal,
  printProfit,
  printShipping,
  printUnitPrice,
  printUnitPriceCents,
  prodigiShippingCost,
  profitFor,
} from '../lib/prints';

/**
 * What these tests can and cannot prove.
 *
 * They prove the *arithmetic*: that whatever costs this catalog claims, the
 * buyer is charged enough to cover them plus both halves of Stripe's fee.
 *
 * They cannot prove the costs are right. Only Prodigi knows that, and the only
 * thing that asks is the admin print check. The previous version of this file
 * had a test named "no order loses money after Stripe fees" that passed
 * throughout the months every base cost in the catalog was wrong — because it
 * compared the catalog against itself, so the errors cancelled. A test like
 * that is worse than no test: it reads as verification.
 */

const photo = findPrintProduct('GLOBAL-PHO-4X6')!;
const bigPhoto = findPrintProduct('GLOBAL-PHO-8X10')!;
const fineArt = findPrintProduct('GLOBAL-FAP-11X14')!;
const framed = findPrintProduct('GLOBAL-CFP-12X16')!;

describe('profit per print', () => {
  it('is a flat few cents on a photo print', () => {
    // Photo prints are a convenience, not a margin line. The shipping dwarfs
    // anything that could sensibly be added here.
    for (const product of PRINT_PRODUCTS.filter((p) => p.kind === 'photo')) {
      expect(profitFor(product)).toBe(PHOTO_PRINT_PROFIT);
    }
  });

  it('follows the margin rule on fine-art and framed prints', () => {
    expect(profitFor(fineArt)).toBeCloseTo(7, 5); // 50% of $14
    expect(profitFor(framed)).toBe(PRINT_MAX_PROFIT); // 50% of $40 is over the cap
  });

  it('targets 50% of base between the floor and the cap', () => {
    expect(printProfit(12)).toBeCloseTo(6, 5);
    expect(printProfit(8)).toBeCloseTo(4, 5);
  });

  it('never drops below the floor or above the cap', () => {
    expect(printProfit(0.15)).toBe(PRINT_MIN_PROFIT);
    expect(printProfit(39)).toBe(PRINT_MAX_PROFIT);
    expect(printProfit(100)).toBe(PRINT_MAX_PROFIT); // exactly $100 is not "over"
    expect(printProfit(101)).toBe(PRINT_MAX_PROFIT_HIGH);
  });
});

describe('the buyer covers both halves of the Stripe fee', () => {
  // The bug this pins: the old pricing grossed up by the 2.9% and silently
  // ignored the $0.30, which is a fifth of the margin on a cheap print.
  it('recovers the fixed fee once per order, in the shipping line', () => {
    const oneCopy = printShipping(photo, 1);
    const tenCopies = printShipping(photo, 10);
    // Photo extras ship free, so the only difference between these two would be
    // the fixed fee if it were charged per print. It is not.
    expect(oneCopy).toBeCloseTo(tenCopies, 5);
    expect(oneCopy).toBeGreaterThan(prodigiShippingCost(photo, 1) + STRIPE_FIXED - 0.01);
  });

  it('grosses the percentage into shipping as well as the print', () => {
    // Stripe charges 2.9% of everything the buyer pays, shipping included.
    // Passing shipping through at cost was the single biggest leak.
    expect(printShipping(photo, 1)).toBeGreaterThan(prodigiShippingCost(photo, 1));
  });
});

describe('no order loses money, at any size', () => {
  const sizes = [1, 2, 3, 5, 10, 25, 50];

  it.each(
    PRINT_PRODUCTS.flatMap((product) => sizes.map((n) => [product.sku, n, product] as const)),
  )('%s × %i nets at least the target profit', (_sku, copies, product) => {
    const buyerPays = printOrderTotal(product, copies);
    const prodigiBills = product.baseCost * copies + prodigiShippingCost(product, copies);
    const stripeTakes = buyerPays * STRIPE_PCT + STRIPE_FIXED;
    const net = buyerPays - prodigiBills - stripeTakes;

    expect(net).toBeGreaterThan(0);
    // Rounding is always up, so the net can exceed the target but never miss it.
    expect(net).toBeGreaterThanOrEqual(profitFor(product) * copies - 0.005);
  });

  it('has almost no headroom on a single photo print, and that is the deal', () => {
    // How far Prodigi's costs can rise before an order goes negative:
    //
    //   4×6    1.35% (one copy)   10.52% (ten)
    //   5×7    1.25%               8.39%
    //   8×10   1.03%               4.30%
    //   11×14 27.19%              46.25%
    //   12×16 15.44%              18.78%
    //
    // A photo print earns $0.10 on an ~$12 order, so ~1% is all the buffer
    // there is. That is a deliberate choice — prints are a convenience and the
    // profit was set to near zero on purpose — but it has a consequence worth
    // stating plainly: Prodigi raised prices about 5% in July 2026, and a rise
    // like that turns every single-copy photo order negative the day it lands.
    //
    // Nothing in this repository will notice. The only defence is running the
    // admin print check, which compares these costs against a live quote. This
    // test exists so that the thinness is a recorded fact rather than a
    // surprise, and so that making it thinner fails here.
    const headroomFor = (product: (typeof PRINT_PRODUCTS)[number], copies: number) => {
      const buyerPays = printOrderTotal(product, copies);
      const canPayProdigi = buyerPays - buyerPays * STRIPE_PCT - STRIPE_FIXED;
      const bills = product.baseCost * copies + prodigiShippingCost(product, copies);
      return canPayProdigi / bills - 1;
    };

    for (const product of PRINT_PRODUCTS) {
      for (const copies of sizes) {
        // Every order absorbs at least a 1% cost rise. Below that the pricing
        // is not covering rounding, let alone reality.
        expect({ sku: product.sku, copies, thin: headroomFor(product, copies) < 0.01 }).toEqual({
          sku: product.sku,
          copies,
          thin: false,
        });
      }
    }

    // And the premium prints, which do carry a margin, have real room.
    expect(headroomFor(fineArt, 1)).toBeGreaterThan(0.15);
    expect(headroomFor(framed, 1)).toBeGreaterThan(0.1);
  });
});

describe('prices are whole cents', () => {
  it('never asks Stripe for a fractional cent', () => {
    for (const product of PRINT_PRODUCTS) {
      expect(Number.isInteger(printUnitPriceCents(product))).toBe(true);
    }
  });
});

describe('shipping', () => {
  it('does not grow when extra photo prints ship free', () => {
    expect(prodigiShippingCost(photo, 5)).toBeCloseTo(prodigiShippingCost(photo, 1), 5);
  });

  it('charges plus-one for each extra framed print', () => {
    expect(prodigiShippingCost(framed, 3)).toBeCloseTo(framed.shipFirst + framed.shipAdd * 2, 5);
  });
});

describe('the delivered price per print', () => {
  // This is what the modal shows to make the case for a bigger order, so it has
  // to actually fall — otherwise the suggestion is a lie with a number on it.
  it('falls as copies rise, for every product', () => {
    for (const product of PRINT_PRODUCTS) {
      const one = deliveredPricePerPrint(product, 1);
      const ten = deliveredPricePerPrint(product, 10);
      expect({ sku: product.sku, cheaper: ten < one }).toEqual({ sku: product.sku, cheaper: true });
    }
  });

  it('falls fastest where shipping dominates the order', () => {
    // A 4×6 is pennies and ships for over $10, so batching is nearly all of the
    // saving. A framed print carries its own plus-one shipping, so it barely
    // moves — and the modal should not push bulk there.
    const photoDrop = deliveredPricePerPrint(photo, 10) / deliveredPricePerPrint(photo, 1);
    const framedDrop = deliveredPricePerPrint(framed, 10) / deliveredPricePerPrint(framed, 1);
    expect(photoDrop).toBeLessThan(0.2);
    expect(framedDrop).toBeGreaterThan(0.8);
  });

  it('is the order total divided by the prints in it', () => {
    expect(deliveredPricePerPrint(bigPhoto, 4)).toBeCloseTo(printOrderTotal(bigPhoto, 4) / 4, 5);
  });

  it('does not divide by zero', () => {
    expect(deliveredPricePerPrint(photo, 0)).toBe(0);
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

  it('gives every product a pricing rule', () => {
    for (const product of PRINT_PRODUCTS) {
      expect(['photo', 'premium']).toContain(product.kind);
    }
  });
});
