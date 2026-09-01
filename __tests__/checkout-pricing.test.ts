import {
  isAdminCaller,
  pricingSourceFor,
} from '../amplify/functions/stripe-checkout/pricing';

const SELLABLE = ['starter', 'standard', 'premium'];
const sellableTier = (tier: string) => SELLABLE.includes(tier);

const owner = 'sub-123::host@example.com';
const host = { sub: 'sub-123' };
const someoneElse = { sub: 'sub-999' };
const admin = { sub: 'sub-999', groups: ['ADMINS'] };

const premiumEvent = { tier: 'premium', owner };

describe('pricingSourceFor — the underpayment this prevents', () => {
  it('prices a real event from its own row, ignoring the tier the request sent', () => {
    // The reported shape: pair a Premium event with tier="starter" and the
    // amount was $19 while the webhook activated a $79 event. The stored tier
    // is now the only thing that decides the price.
    const source = pricingSourceFor({
      eventId: 'evt-1',
      argumentTier: 'starter',
      stored: premiumEvent,
      sellableTier,
      caller: host,
    });
    expect(source).toEqual({ kind: 'event', tier: 'premium' });
  });

  it('is unmoved by any tier the request claims', () => {
    for (const argumentTier of ['starter', 'standard', 'premium', '', 'free', 'PREMIUM']) {
      const source = pricingSourceFor({
        eventId: 'evt-1',
        argumentTier,
        stored: premiumEvent,
        sellableTier,
        caller: host,
      });
      expect(source).toEqual({ kind: 'event', tier: 'premium' });
    }
  });
});

describe('pricingSourceFor — who may pay', () => {
  it('lets a host pay for their own event', () => {
    expect(
      pricingSourceFor({
        eventId: 'evt-1',
        argumentTier: 'premium',
        stored: premiumEvent,
        sellableTier,
        caller: host,
      }).kind,
    ).toBe('event');
  });

  it('refuses someone else’s event', () => {
    const source = pricingSourceFor({
      eventId: 'evt-1',
      argumentTier: 'premium',
      stored: premiumEvent,
      sellableTier,
      caller: someoneElse,
    });
    expect(source.kind).toBe('refused');
  });

  it('refuses a signed-out caller', () => {
    expect(
      pricingSourceFor({
        eventId: 'evt-1',
        argumentTier: 'premium',
        stored: premiumEvent,
        sellableTier,
        caller: null,
      }).kind,
    ).toBe('refused');
  });

  it('lets an admin pay for any event, so one can be comped', () => {
    expect(
      pricingSourceFor({
        eventId: 'evt-1',
        argumentTier: 'starter',
        stored: premiumEvent,
        sellableTier,
        caller: admin,
      }),
    ).toEqual({ kind: 'event', tier: 'premium' });
  });

  it('gives the same answer for a missing event and someone else’s', () => {
    // Otherwise the difference tells a caller which event ids exist.
    const missing = pricingSourceFor({
      eventId: 'evt-nope',
      argumentTier: 'premium',
      stored: null,
      sellableTier,
      caller: host,
    });
    const notMine = pricingSourceFor({
      eventId: 'evt-1',
      argumentTier: 'premium',
      stored: premiumEvent,
      sellableTier,
      caller: someoneElse,
    });
    expect(missing).toEqual(notMine);
  });

  it('refuses an event whose plan is no longer sold', () => {
    expect(
      pricingSourceFor({
        eventId: 'evt-1',
        argumentTier: 'premium',
        stored: { tier: 'legacy-gold', owner },
        sellableTier,
        caller: host,
      }).kind,
    ).toBe('refused');
  });
});

describe('pricingSourceFor — the admin test checkout', () => {
  it('prices from the request when no event is being activated', () => {
    // Nothing is activated on this path, so the argument grants nothing.
    expect(
      pricingSourceFor({
        eventId: '',
        argumentTier: 'standard',
        stored: null,
        sellableTier,
        caller: admin,
      }),
    ).toEqual({ kind: 'argument', tier: 'standard' });
  });

  it('normalises the case of a supplied tier', () => {
    expect(
      pricingSourceFor({
        eventId: '',
        argumentTier: 'PREMIUM',
        stored: null,
        sellableTier,
        caller: admin,
      }),
    ).toEqual({ kind: 'argument', tier: 'premium' });
  });

  it('refuses a tier we do not sell', () => {
    expect(
      pricingSourceFor({
        eventId: '',
        argumentTier: 'free',
        stored: null,
        sellableTier,
        caller: admin,
      }),
    ).toEqual({ kind: 'refused', reason: 'Unknown plan.' });
  });
});

describe('isAdminCaller', () => {
  it('recognises the admin group and nothing else', () => {
    expect(isAdminCaller(admin)).toBe(true);
    expect(isAdminCaller(host)).toBe(false);
    expect(isAdminCaller({ sub: 'x', groups: ['admins'] })).toBe(false);
    expect(isAdminCaller({ sub: 'x', groups: null })).toBe(false);
    expect(isAdminCaller(null)).toBe(false);
  });
});
