import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_TIERS,
  GUEST_BOOK_ADDON_PRICE,
  LIVE_SLIDESHOW_INCLUDED_TIERS,
  PRICING_TIERS,
  isSellableTier,
} from '../lib/pricing';

/**
 * Customer-facing copy against the plans that actually exist.
 *
 * Eight contradictions were found across the public pages and help articles,
 * and four of them were one regression: when the plans collapsed to Free +
 * $79, the pricing page was updated and the help articles were not. They went
 * on describing Starter, Standard, Premium and a $19 guest-book add-on on a
 * plan called "Event" — a structure that had been gone for months.
 *
 * Correcting the sentences would leave the mechanism that produced them, which
 * is prose restating facts that live in lib/pricing.ts. This is the guard: if
 * a plan is retired, nothing customer-facing may still name it.
 */

const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

const CUSTOMER_FACING: Array<[string, string]> = [
  ['help articles', 'lib/help.ts'],
  ['the guest book demo', 'pages/demo/guestbook.tsx'],
  ['the pricing page', 'pages/pricing.tsx'],
  ['the homepage', 'pages/index.tsx'],
];

/** Names of plans that can no longer be bought. */
const retiredNames = ALL_TIERS.filter((tier) => !isSellableTier(tier.id)).map((tier) => tier.name);

describe('no customer-facing copy names a retired plan', () => {
  it('has retired plans to check against, so this test can actually fail', () => {
    expect(retiredNames.length).toBeGreaterThan(0);
    expect(PRICING_TIERS.length).toBeLessThan(ALL_TIERS.length);
  });

  it.each(CUSTOMER_FACING)('%s', (_label, path) => {
    const source = read(...path.split('/'));
    for (const name of retiredNames) {
      // "Event (original)" is an admin-facing label for a grandfathered tier
      // and never appears in prose; the ones that bit were Starter, Standard
      // and Premium, named as if a customer could still pick them.
      if (name.includes('(')) continue;
      const mentions = new RegExp(`\\b${name}\\b`).test(source);
      expect({ file: path, plan: name, mentions }).toEqual({
        file: path,
        plan: name,
        mentions: false,
      });
    }
  });
});

describe('the add-ons the copy offers are add-ons that exist', () => {
  const help = read('lib', 'help.ts');

  it('does not tell a host to buy the slideshow, which the paid plan includes', () => {
    // lib/pricing.ts: 'plus' is in LIVE_SLIDESHOW_INCLUDED_TIERS. The article
    // opened with "Buy the Live slideshow add-on from your dashboard".
    expect(LIVE_SLIDESHOW_INCLUDED_TIERS).toContain('plus');
    expect(help).not.toMatch(/Buy the Live slideshow add-on/i);
  });

  it('does not price the guest book as an extra on the plan that includes it', () => {
    const demo = read('pages', 'demo', 'guestbook.tsx');
    expect(demo).not.toContain(`$${GUEST_BOOK_ADDON_PRICE} add-on`);
  });

  it('does not contradict its own "nothing is sold as an add-on" line', () => {
    // help.ts said both "nothing is sold as an add-on on top" and "Add-ons sit
    // in one list: extend the upload window, and the live slideshow", three
    // entries apart.
    expect(help).toMatch(/nothing is sold as an add-on/i);
    expect(help).not.toMatch(/Add-ons sit in one list on your dashboard: extend/i);
  });
});

describe('the copy does not send people somewhere that does not exist', () => {
  it('does not tell guests to type an event code on the home page', () => {
    // There is no code-entry field on the homepage, or anywhere guest-facing.
    // A guest holding only a code was being told to do something impossible.
    const home = read('pages', 'index.tsx');
    const hasCodeEntry = /event code/i.test(home) && /<input/i.test(home);
    expect(hasCodeEntry).toBe(false);

    const help = read('lib', 'help.ts');
    expect(help).not.toMatch(/enter it on the sharepix\.net home page/i);
    expect(help).not.toMatch(/enter the event code on the home page/i);
  });
});

describe('privacy is described the same way everywhere', () => {
  it('does not call a gallery private where the help calls it shared', () => {
    // help.ts: "It is a shared album, not a private one" — anyone with the
    // code can open it. The homepage called the same thing a private gallery.
    const home = read('pages', 'index.tsx');
    const help = read('lib', 'help.ts');
    expect(help).toMatch(/shared album, not a private one/i);
    expect(home).not.toMatch(/private gallery/i);
  });
});
