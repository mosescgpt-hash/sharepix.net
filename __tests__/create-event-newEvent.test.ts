import {
  CORPORATE_EVENT_PLAN,
  EVENT_CODE_ALPHABET,
  TIER_PLANS,
  activationFor,
  codeCovers,
  codeUsable,
  eventCodeFrom,
  formatEventLocation,
  hostNameFrom,
  isCorporateStatusActive,
  isTrialTier,
  newEventRow,
  normalizeTier,
  ownerStringFor,
  planFor,
  remainingCents,
  sanitizeEventDate,
  sanitizeEventName,
  type DiscountRow,
} from '../amplify/functions/create-event/newEvent';

const NOW = new Date('2026-06-01T12:00:00.000Z');

function code(overrides: Partial<DiscountRow> = {}): DiscountRow {
  return {
    code: 'PILOT',
    active: true,
    expiresAt: '2027-01-01T00:00:00.000Z',
    usedCount: 0,
    maxUses: 10,
    unlimitedUses: false,
    appliesToScopes: 'all',
    appliesToTier: 'all',
    discountType: 'percent',
    percentOff: 100,
    amountOffCents: null,
    ...overrides,
  };
}

describe('plans', () => {
  it('can create an event on every tier lib/pricing.ts knows about', () => {
    // The list is pinned by name rather than counted, because the failure this
    // guards is a MISSING key, not an extra one: planFor returns null for a
    // tier it has never heard of and handler.ts turns the creation away. That
    // is how the Event/Plus reprice shipped a create-event form that refused
    // both live plans. If you retire or add a tier in lib/pricing.ts, this line
    // is the one that should stop you.
    expect(Object.keys(TIER_PLANS).sort()).toEqual([
      'event',
      'free',
      'plus',
      'premium',
      'standard',
      'starter',
    ]);
    expect(planFor('corporate')).toBe(CORPORATE_EVENT_PLAN);
  });

  it('prices the plan on sale at what the pricing page charges', () => {
    // The number a customer actually sees. Duplicated by hand from
    // lib/pricing.ts because Amplify functions cannot import from lib/.
    expect(TIER_PLANS.plus.priceCents).toBe(7900);
    expect(TIER_PLANS.free.priceCents).toBe(0);
    // The retired $39 tier, still priced so an unpaid event on it can be paid.
    expect(TIER_PLANS.event.priceCents).toBe(3900);
  });

  it('marks only the free tier as a trial', () => {
    // A price of zero is not enough: a fully comped paid event owes zero too,
    // and a comped event may buy add-ons while a trial may not.
    expect(isTrialTier('free')).toBe(true);
    for (const id of ['plus', 'event', 'starter', 'standard', 'premium', 'corporate']) {
      expect(isTrialTier(id)).toBe(false);
    }
  });

  it('refuses a tier we do not sell', () => {
    for (const tier of ['', 'gratis', 'unlimited', 'PREMIUM ', 'admin']) {
      const plan = planFor(tier);
      // The trailing-space/uppercase one is real and must still resolve.
      if (tier.trim().toLowerCase() === 'premium') expect(plan).not.toBeNull();
      else expect(plan).toBeNull();
    }
  });

  it('normalizes case and surrounding space', () => {
    expect(normalizeTier('  Premium ')).toBe('premium');
    expect(normalizeTier(null)).toBe('');
  });

  it('states every plan completely, so no field can be silently undefined', () => {
    for (const plan of [...Object.values(TIER_PLANS), CORPORATE_EVENT_PLAN]) {
      expect(typeof plan.priceCents).toBe('number');
      expect(typeof plan.accessDays).toBe('number');
      // null is meaningful here (unlimited); undefined is not.
      expect(plan.photoLimit === null || typeof plan.photoLimit === 'number').toBe(true);
      expect(plan.videoLimit === null || typeof plan.videoLimit === 'number').toBe(true);
    }
  });

  it('never leaves video unbounded by omission', () => {
    // Videos are the one upload whose cost isn't bounded by resizing, so an
    // accidental null here would be expensive on every plan.
    //
    // The check is "bounded by SOMETHING" rather than "has a count": the paid
    // plan is sold as a 10 GB budget now and carries no count at all, which is
    // deliberate — a count on top would bind first for anyone filming short
    // clips. A plan with neither is still the failure this guards against.
    for (const plan of [...Object.values(TIER_PLANS), CORPORATE_EVENT_PLAN]) {
      const bounded =
        (typeof plan.videoLimit === 'number' && plan.videoLimit > 0) ||
        (typeof plan.videoBytesLimit === 'number' && plan.videoBytesLimit > 0);
      expect(bounded).toBe(true);
    }
  });

  it('stamps the video budget onto the row so a later change cannot shrink it', () => {
    const plan = planFor('plus');
    expect(plan?.videoBytesLimit).toBe(10 * 1024 * 1024 * 1024);
  });
});

describe('input cleaning', () => {
  it('bounds the event name and strips control characters', () => {
    expect(sanitizeEventName('  Sam & Riley  ')).toBe('Sam & Riley');
    expect(sanitizeEventName('a\u0000b\u001Fc\u007Fd')).toBe('a b c d');
    expect(sanitizeEventName('x'.repeat(200))).toHaveLength(80);
    expect(sanitizeEventName('   ')).toBe('');
    expect(sanitizeEventName(null)).toBe('');
  });

  it('keeps a newline out of the name, which ends up in filenames and email', () => {
    expect(sanitizeEventName('Wedding\r\nBcc: someone@example.com')).toBe(
      'Wedding Bcc: someone@example.com',
    );
  });

  it('formats a location and drops anything that is not a place name', () => {
    expect(formatEventLocation('Minneapolis', 'MN')).toBe('Minneapolis, MN');
    expect(formatEventLocation("Coeur d'Alene", 'ID')).toBe("Coeur d'Alene, ID");
    expect(formatEventLocation('St. Paul', '')).toBe('St. Paul');
    expect(formatEventLocation('', '')).toBe('');
    expect(formatEventLocation('<script>alert(1)</script>', '')).toBe('script alert 1 script');
  });

  it('accepts only a real calendar date', () => {
    expect(sanitizeEventDate('2026-06-01')).toBe('2026-06-01');
    expect(sanitizeEventDate(' 2026-06-01 ')).toBe('2026-06-01');
    // Parses, but rolls over into March — not the date anyone typed.
    expect(sanitizeEventDate('2026-02-30')).toBeNull();
    expect(sanitizeEventDate('2026-13-01')).toBeNull();
    expect(sanitizeEventDate('June 1st')).toBeNull();
    expect(sanitizeEventDate('')).toBeNull();
    expect(sanitizeEventDate(undefined)).toBeNull();
  });
});

describe('identity', () => {
  it('builds the owner string the schema’s owner rules read', () => {
    expect(ownerStringFor('sub-1', 'user-1')).toBe('sub-1::user-1');
  });

  it('falls back to the bare sub rather than a trailing separator', () => {
    // "sub::" would not match the owner rule, locking the host out of their own
    // event; the sub alone still matches the sub-prefix checks we do elsewhere.
    expect(ownerStringFor('sub-1', '')).toBe('sub-1');
  });

  it('is empty without a sub, so an unowned event is detectable', () => {
    expect(ownerStringFor('', 'user-1')).toBe('');
    expect(ownerStringFor('   ', 'user-1')).toBe('');
  });

  it('prefers the saved profile name, then the email local part', () => {
    expect(hostNameFrom('Riley Chen', 'sam@example.com')).toBe('Riley Chen');
    expect(hostNameFrom('', 'sam@example.com')).toBe('sam');
    expect(hostNameFrom('  ', '')).toBe('Host');
  });
});

describe('corporate subscriptions', () => {
  it('counts active, trialing and past_due as live', () => {
    for (const status of ['active', 'trialing', 'past_due', 'ACTIVE', ' active ']) {
      expect(isCorporateStatusActive(status)).toBe(true);
    }
  });

  it('counts anything else, including nothing, as not live', () => {
    for (const status of ['canceled', 'incomplete', 'unpaid', '', null, undefined]) {
      expect(isCorporateStatusActive(status)).toBe(false);
    }
  });
});

describe('discount code scope', () => {
  it('honours an explicit scope list', () => {
    const row = code({ appliesToScopes: 'event:premium,extend' });
    expect(codeCovers(row, 'event:premium')).toBe(true);
    expect(codeCovers(row, 'event:starter')).toBe(false);
  });

  it('treats a bare "event" scope as covering every plan', () => {
    const row = code({ appliesToScopes: 'event' });
    expect(codeCovers(row, 'event:starter')).toBe(true);
    expect(codeCovers(row, 'event:premium')).toBe(true);
    expect(codeCovers(row, 'corporate')).toBe(false);
  });

  it('honours "all"', () => {
    expect(codeCovers(code({ appliesToScopes: 'all' }), 'event:standard')).toBe(true);
  });

  it('falls back to the legacy per-tier field when no scopes are stored', () => {
    const legacy = code({ appliesToScopes: '', appliesToTier: 'premium' });
    expect(codeCovers(legacy, 'event:premium')).toBe(true);
    expect(codeCovers(legacy, 'event:starter')).toBe(false);

    const universal = code({ appliesToScopes: '', appliesToTier: 'all' });
    expect(codeCovers(universal, 'event:starter')).toBe(true);
  });
});

describe('discount code validity', () => {
  const scope = 'event:standard';
  const now = NOW.getTime();

  it('accepts a good code', () => {
    expect(codeUsable(code(), scope, now)).toEqual({ ok: true });
  });

  it('refuses a missing, inactive, or expired code', () => {
    expect(codeUsable(null, scope, now).ok).toBe(false);
    expect(codeUsable(code({ active: false }), scope, now).ok).toBe(false);
    expect(codeUsable(code({ expiresAt: '2020-01-01T00:00:00Z' }), scope, now).ok).toBe(false);
  });

  it('refuses a code with no uses left, but not an unlimited one', () => {
    expect(codeUsable(code({ usedCount: 10, maxUses: 10 }), scope, now).ok).toBe(false);
    expect(
      codeUsable(code({ usedCount: 999, maxUses: 10, unlimitedUses: true }), scope, now).ok,
    ).toBe(true);
  });

  it('refuses a code scoped to a different plan', () => {
    const row = code({ appliesToScopes: 'event:premium' });
    expect(codeUsable(row, 'event:starter', now).ok).toBe(false);
  });

  it('refuses a misconfigured code rather than guessing what it meant', () => {
    expect(codeUsable(code({ percentOff: 0 }), scope, now).ok).toBe(false);
    expect(codeUsable(code({ percentOff: 150 }), scope, now).ok).toBe(false);
    expect(
      codeUsable(code({ discountType: 'amount', amountOffCents: 0 }), scope, now).ok,
    ).toBe(false);
  });

  it('treats a missing percentOff as fully comped, as legacy codes meant', () => {
    expect(codeUsable(code({ percentOff: null }), scope, now)).toEqual({ ok: true });
  });
});

describe('what a code leaves owing', () => {
  it('comps the whole price at 100%', () => {
    expect(remainingCents(3900, code({ percentOff: 100 }))).toBe(0);
  });

  it('takes a percentage off', () => {
    expect(remainingCents(3900, code({ percentOff: 50 }))).toBe(1950);
    expect(remainingCents(1900, code({ percentOff: 10 }))).toBe(1710);
  });

  it('takes a fixed amount off', () => {
    const amount = code({ discountType: 'amount', amountOffCents: 1000, percentOff: null });
    expect(remainingCents(3900, amount)).toBe(2900);
  });

  it('comps a remainder Stripe is too small to charge', () => {
    // $38.80 off a $39 event leaves 20c, which would fail at the card step.
    const amount = code({ discountType: 'amount', amountOffCents: 3880, percentOff: null });
    expect(remainingCents(3900, amount)).toBe(0);
    // Same rule for a percentage that lands just short.
    expect(remainingCents(3900, code({ percentOff: 99 }))).toBe(0);
  });

  it('never goes negative when the code is worth more than the event', () => {
    const amount = code({ discountType: 'amount', amountOffCents: 999999, percentOff: null });
    expect(remainingCents(1900, amount)).toBe(0);
  });
});

describe('activation — the rule that used to be missing entirely', () => {
  it('creates a paid plan pending, owing the full price', () => {
    expect(activationFor({ tier: 'standard', corporateActive: false, discount: null })).toEqual({
      kind: 'pending',
      owedCents: 3900,
    });
  });

  it('refuses a tier we do not sell', () => {
    const decision = activationFor({ tier: 'gratis', corporateActive: false, discount: null });
    expect(decision.kind).toBe('refused');
  });

  it('activates a free event owing nothing, flagged as a trial', () => {
    // `via` is not decoration: the handler claims the account's one free event
    // on 'trial' and spends a discount code on 'comped'. Confusing the two
    // either hands out unlimited free events or burns a code for nothing.
    expect(activationFor({ tier: 'free', corporateActive: false, discount: null })).toEqual({
      kind: 'active',
      via: 'trial',
    });
  });

  it('never lets a discount code turn a free event into a comped one', () => {
    // A code applied to a $0 plan would come back `comped`, spending a use of
    // the code to discount nothing and disguising a trial as a purchase. The
    // handler drops the code before this point; the trial branch here is the
    // second line of that defence.
    const decision = activationFor({
      tier: 'free',
      corporateActive: false,
      discount: { row: code(), priceCents: 0 },
    });
    expect(decision).toEqual({ kind: 'active', via: 'trial' });
  });

  it('activates a corporate event only with a live subscription', () => {
    expect(activationFor({ tier: 'corporate', corporateActive: true, discount: null })).toEqual({
      kind: 'active',
      via: 'corporate',
    });
    expect(
      activationFor({ tier: 'corporate', corporateActive: false, discount: null }).kind,
    ).toBe('refused');
  });

  it('activates when a code covers the whole price', () => {
    expect(
      activationFor({
        tier: 'premium',
        corporateActive: false,
        discount: { row: code({ percentOff: 100 }), priceCents: 7900 },
      }),
    ).toEqual({ kind: 'active', via: 'comped' });
  });

  it('leaves a partial code pending, owing the discounted price', () => {
    expect(
      activationFor({
        tier: 'premium',
        corporateActive: false,
        discount: { row: code({ percentOff: 25 }), priceCents: 7900 },
      }),
    ).toEqual({ kind: 'pending', owedCents: 5925 });
  });

  it('does not let a corporate subscription comp a paid event plan', () => {
    // A subscriber creating a Premium event still pays for it — the
    // subscription covers corporate events, not every event they make.
    expect(
      activationFor({ tier: 'premium', corporateActive: true, discount: null }),
    ).toEqual({ kind: 'pending', owedCents: 7900 });
  });

  it('does not let a code comp a corporate event without a subscription', () => {
    // A corporate event is worth nothing to comp and everything to have; the
    // code path must not become a way around the subscription check.
    const decision = activationFor({
      tier: 'corporate',
      corporateActive: false,
      discount: { row: code({ percentOff: 100 }), priceCents: 0 },
    });
    expect(decision.kind).toBe('refused');
  });
});

describe('the row a new event starts as', () => {
  const base = { name: 'Sam & Riley', tier: 'event', hostName: 'Riley', active: false, now: NOW };

  it('stamps limits and dates from the plan, not from the caller', () => {
    const row = newEventRow(base);
    expect(row.photoLimit).toBe(1000);
    expect(row.videoLimit).toBe(10);
    // 60-day upload window on every plan, then a 12-month gallery.
    expect(row.uploadWindowEndsAt).toBe('2026-07-31T12:00:00.000Z');
    expect(row.accessExpiresAt).toBe('2027-07-31T12:00:00.000Z');
  });

  it('gives a retired plan the access window it was actually sold', () => {
    // The window is global and lengthening it is a gift, but access length was
    // part of what the plan was, so it stays stamped from the plan's own row.
    const row = newEventRow({ ...base, tier: 'standard' });
    expect(row.uploadWindowEndsAt).toBe('2026-07-31T12:00:00.000Z');
    expect(row.accessExpiresAt).toBe('2026-08-30T12:00:00.000Z');
  });

  it('leaves an unlimited photo limit as null rather than a number', () => {
    expect(newEventRow({ ...base, tier: 'premium' }).photoLimit).toBeNull();
    expect(newEventRow({ ...base, tier: 'premium' }).videoLimit).toBe(30);
  });

  it('carries the activation decision into paid', () => {
    expect(newEventRow({ ...base, active: false }).paid).toBe(false);
    expect(newEventRow({ ...base, active: true }).paid).toBe(true);
  });

  it('normalizes the tier it stores', () => {
    expect(newEventRow({ ...base, tier: ' Premium ' }).tier).toBe('premium');
  });

  it('stores a location only when there is one', () => {
    expect(newEventRow({ ...base, city: 'Minneapolis', state: 'MN' }).location).toBe(
      'Minneapolis, MN',
    );
    expect(newEventRow(base).location).toBeNull();
  });

  it('refuses an empty name and an unknown plan', () => {
    expect(() => newEventRow({ ...base, name: '   ' })).toThrow(/name/i);
    expect(() => newEventRow({ ...base, tier: 'gratis' })).toThrow(/plan/i);
  });

  it('never stores an empty host name', () => {
    expect(newEventRow({ ...base, hostName: '' }).createdBy).toBe('Host');
  });
});

describe('event codes', () => {
  it('draws the right length from the unambiguous alphabet', () => {
    let calls = 0;
    const codeText = eventCodeFrom((max) => {
      calls += 1;
      expect(max).toBe(EVENT_CODE_ALPHABET.length);
      return 0;
    });
    expect(codeText).toBe('AAAAAA');
    expect(calls).toBe(6);
  });

  it('has no characters that get misread aloud', () => {
    // No 0/O and no 1/I/L: these are read off a table tent and typed by guests.
    expect(EVENT_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('uses every index the alphabet offers', () => {
    let i = 0;
    const codeText = eventCodeFrom(() => i++);
    expect(codeText).toBe(EVENT_CODE_ALPHABET.slice(0, 6));
  });
});
