import {
  CORPORATE_EXTRA_EVENT_CENTS,
  CORPORATE_INCLUDED_EVENTS,
  CORPORATE_MONTHLY_CENTS,
  GUEST_BOOK_ADDON_CENTS,
  LIVE_SLIDESHOW_ADDON_CENTS,
  PLAN_PRICE_CENTS,
} from '../lib/priceList';
import {
  ALL_TIERS,
  CORPORATE_PLAN,
  GUEST_BOOK_ADDON_PRICE,
  LIVE_SLIDESHOW_ADDON_PRICE,
} from '../lib/pricing';
import { FAIR_USE_PHOTO_CEILING } from '../lib/fairUse';
import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * One price list, and nothing that can drift from it.
 *
 * Prices used to be typed in lib/pricing.ts (dollars), stripe-checkout
 * (cents) and create-event (cents again). A reprice that reached one and not
 * the others would advertise one price and charge another, silently. These
 * guards are what make "edit lib/priceList.ts and re-copy" the whole job.
 */

const COPIES = [
  'amplify/functions/stripe-checkout/priceList.ts',
  'amplify/functions/create-event/priceList.ts',
];

describe('the copies have not drifted', () => {
  it.each(COPIES)('%s matches lib/priceList.ts below the header', (copy) => {
    expect(bodyOf(readSource(copy))).toBe(bodyOf(readSource('lib/priceList.ts')));
  });
});

describe('the site advertises what Stripe charges', () => {
  it('derives every plan price from the list', () => {
    for (const tier of ALL_TIERS) {
      expect(tier.price * 100).toBe(PLAN_PRICE_CENTS[tier.id]);
    }
  });

  it('derives Corporate and the add-ons from the list', () => {
    expect(CORPORATE_PLAN.price * 100).toBe(CORPORATE_MONTHLY_CENTS);
    expect(CORPORATE_PLAN.extraEventPrice * 100).toBe(CORPORATE_EXTRA_EVENT_CENTS);
    expect(CORPORATE_PLAN.includedEvents).toBe(CORPORATE_INCLUDED_EVENTS);
    expect(LIVE_SLIDESHOW_ADDON_PRICE * 100).toBe(LIVE_SLIDESHOW_ADDON_CENTS);
    expect(GUEST_BOOK_ADDON_PRICE * 100).toBe(GUEST_BOOK_ADDON_CENTS);
  });

  it('states the same photo ceiling on Corporate as on the Full Event', () => {
    const ceiling = FAIR_USE_PHOTO_CEILING.toLocaleString('en-US');
    expect(CORPORATE_PLAN.features.some((f) => f.includes(`fair-use ceiling ${ceiling}`))).toBe(
      true,
    );
  });

  it('prices an extra Corporate event below a single event', () => {
    // It is sold as a discount for subscribers; at or above $79 it would be
    // cheaper to buy a Full Event than to be a customer.
    expect(CORPORATE_EXTRA_EVENT_CENTS).toBeLessThan(PLAN_PRICE_CENTS.plus);
  });
});

describe('no handler types a price', () => {
  // Every price in the list, as the literal someone would type. A handler
  // carrying one of these is a second copy waiting to drift.
  const literals = [
    ...Object.values(PLAN_PRICE_CENTS),
    CORPORATE_MONTHLY_CENTS,
    CORPORATE_EXTRA_EVENT_CENTS,
    LIVE_SLIDESHOW_ADDON_CENTS,
    GUEST_BOOK_ADDON_CENTS,
  ]
    .filter((cents) => cents > 0)
    .map(String);

  it.each([
    'amplify/functions/stripe-checkout/handler.ts',
    'amplify/functions/create-event/newEvent.ts',
    'amplify/functions/create-event/handler.ts',
  ])('%s reads prices from ./priceList', (path) => {
    const code = codeOnly(readSource(path));
    for (const literal of literals) {
      expect(code).not.toMatch(new RegExp(`\\b${literal}\\b`));
    }
  });
});

describe('the Corporate extra event at checkout', () => {
  const checkout = codeOnly(readSource('amplify/functions/stripe-checkout/handler.ts'));

  it('is kept out of TIER_PRICING, so it can never be extended at half price', () => {
    const block = checkout.slice(
      checkout.indexOf('const TIER_PRICING'),
      checkout.indexOf('};', checkout.indexOf('const TIER_PRICING')),
    );
    expect(block).not.toContain('corporate');
  });

  it('is priceable only while the stored event is unpaid', () => {
    // The included events are created paid. Without this a request naming one
    // would charge a subscriber $49 for an event they already have.
    expect(checkout).toContain("candidate === 'corporate' && storedEvent?.paid === false");
  });
});

describe('the docs no longer float other prices', () => {
  it('marks the brief’s $39 / $69 lineup as superseded in the redesign audit', () => {
    const audit = readSource('docs/redesign-audit.md');
    expect(audit).toMatch(/superseded/i);
    expect(audit).toContain('lib/priceList.ts');
  });
});

describe('help articles quote the numbers the code uses', () => {
  // Help is prose, so it types its numbers. This is what catches it when the
  // code moves and the prose does not.
  const help = readSource('lib/help.ts');

  it('states the fair-use ceiling', () => {
    expect(help).toContain(FAIR_USE_PHOTO_CEILING.toLocaleString('en-US'));
  });

  it('states Corporate as it is sold', () => {
    expect(help).toContain(`$${CORPORATE_PLAN.price} a month`);
    expect(help).toContain(`up to ${CORPORATE_PLAN.includedEvents} events`);
    expect(help).toContain(`$${CORPORATE_PLAN.extraEventPrice}`);
  });
});
