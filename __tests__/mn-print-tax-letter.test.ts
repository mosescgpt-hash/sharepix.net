import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRINT_PRODUCTS, printShipping, printUnitPrice } from '../lib/prints';

/**
 * The letter to the Department of Revenue quotes what a buyer actually pays.
 *
 * Its own "Before sending" list says to re-check the table against
 * `lib/prints.ts` by hand, which is the kind of instruction that gets followed
 * the first time and then not. Prodigi's prices have already moved once; a
 * letter asking a tax authority about $0.39 prints while the site charges
 * something else invites an answer to the wrong question, and the copy that
 * gets posted is the one nobody re-reads.
 *
 * So the figures are pinned here instead. Change a price and this fails, which
 * is the only reminder that arrives on time.
 */

const LETTER = join(__dirname, '..', 'docs', 'mn-print-tax-request.md');

/** The block quote, `> ` stripped — the same slice the .docx generator takes. */
function letter(): string {
  const lines = readFileSync(LETTER, 'utf8').split('\n');
  const quoted: string[] = [];
  let inQuote = false;
  for (const line of lines) {
    if (line.startsWith('> ') || line === '>') {
      inQuote = true;
      quoted.push(line.replace(/^> ?/, ''));
    } else if (inQuote && line.trim() === '') {
      quoted.push('');
    } else if (inQuote) {
      break;
    }
  }
  return quoted.join('\n').trim();
}

/** `| 4×6 in photo print | $0.39 each |` → `['4×6', 0.39]`. */
function quotedPrices(): Array<[string, number]> {
  return letter()
    .split('\n')
    .map((line) => /^\|\s*([\d×]+)\s*in [^|]+\|\s*\$([\d.]+) each\s*\|$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1], Number(match[2])]);
}

describe('the Minnesota print tax letter', () => {
  it('has a block quote for the generator to render', () => {
    expect(letter().length).toBeGreaterThan(500);
  });

  it('quotes a price for every product, and no others', () => {
    const quoted = quotedPrices();
    expect(quoted).toHaveLength(PRINT_PRODUCTS.length);
    expect(quoted.map(([size]) => size)).toEqual(
      PRINT_PRODUCTS.map((product) => product.sku.replace(/^.*-/, '').replace('X', '×')),
    );
  });

  it('quotes the price the site actually charges', () => {
    const quoted = quotedPrices();
    PRINT_PRODUCTS.forEach((product, index) => {
      expect(quoted[index][1]).toBeCloseTo(printUnitPrice(product), 2);
    });
  });

  it('quotes the shipping and the one-print total that follow from those prices', () => {
    const cheapest = PRINT_PRODUCTS[0];
    const shipping = printShipping(cheapest, 1);
    const total = printUnitPrice(cheapest) + shipping;

    // Prose wraps mid-sentence in the source, so match on the unwrapped text.
    const prose = letter().replace(/\s+/g, ' ');
    // "$12.27 on a single 4×6 order, for example, so a one-print order totals $12.66"
    expect(prose).toContain(`$${shipping.toFixed(2)} on a single`);
    expect(prose).toContain(`totals $${total.toFixed(2)}`);
  });

  it('still asks all five questions', () => {
    const questions = letter().match(/^\d+\.\s/gm) ?? [];
    expect(questions).toHaveLength(5);
  });

  it('says the prints are shipped by Prodigi and paid for to SharePix', () => {
    // The whole point of question 2 is the two-sale drop-shipment, and the
    // answer is worthless if the letter did not describe it.
    const text = letter();
    expect(text).toContain('ships it **directly to the buyer**');
    expect(text).toContain('The buyer pays **SharePix**');
  });
});
