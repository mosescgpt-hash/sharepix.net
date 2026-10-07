import { eventStatusNotices } from '../lib/eventStatus';
import { CORPORATE_PLAN, getTier } from '../lib/pricing';
import {
  DEFAULT_FREE_EVENTS_PER_DAY,
  guestBookLimitReached,
  quotaKind,
  corporateMonthInUse,
  trialDayId,
} from '../lib/quotaCounters';
import { MAX_ENTRIES_PER_ADDRESS, MAX_ENTRIES_PER_GUEST } from '../lib/guestBook';
import { codeOnly, readSource } from './sourceGuards';

/**
 * The dashboard additions: what a host is told at the top of their event, and
 * what the admin limits list reads out of a counter row.
 */

const day = (iso: string) => new Date(iso);

describe('the host dashboard notices', () => {
  it('tells a host an unpaid event is not live, with the plan price', () => {
    const [notice] = eventStatusNotices({ tier: 'plus', paid: false });
    expect(notice.kind).toBe('unpaid');
    expect(notice.kind === 'unpaid' && notice.priceUsd).toBe(getTier('plus')?.price);
  });

  it('prices an unpaid Corporate event as an extra event, and says why', () => {
    const [notice] = eventStatusNotices({ tier: 'corporate', paid: false });
    expect(notice.kind === 'unpaid' && notice.priceUsd).toBe(CORPORATE_PLAN.extraEventPrice);
    expect(notice.body).toContain(`this month's ${CORPORATE_PLAN.includedEvents} included`);
  });

  it('says nothing about payment on a paid or older event', () => {
    for (const paid of [true, null, undefined]) {
      expect(eventStatusNotices({ tier: 'plus', paid }).some((n) => n.kind === 'unpaid')).toBe(
        false,
      );
    }
  });

  it('tells a free event when its gallery is deleted, and points at the paid plan', () => {
    const notices = eventStatusNotices({
      tier: 'trial',
      paid: true,
      uploadWindowEndsAt: day('2026-10-15T00:00:00Z'),
      galleryClosesAt: day('2026-10-29T00:00:00Z'),
    });
    const trial = notices.find((n) => n.kind === 'trial');
    expect(trial?.body).toMatch(/gallery closes on/);
    expect(trial?.body).toMatch(/deleted/);
    expect(trial?.kind === 'trial' && trial.upgradePriceUsd).toBe(getTier('plus')?.price);
  });

  it('treats the retired free tier as a free event too', () => {
    expect(eventStatusNotices({ tier: 'free', paid: true }).map((n) => n.kind)).toEqual([
      'trial',
    ]);
  });

  it('counts this month’s Corporate events, and warns before the next one costs extra', () => {
    const open = eventStatusNotices(
      { tier: 'corporate', paid: true },
      { included: 10, used: 7, resetsAt: '2026-11-01T00:00:00Z' },
    )[0];
    expect(open.title).toBe('7 of 10 included events used this month');
    expect(open.tone).toBe('info');
    expect(open.body).toContain('3 more this month');
    expect(open.body).toContain('no limit on how many run at once');

    const full = eventStatusNotices(
      { tier: 'corporate', paid: true },
      { included: 10, used: 10, resetsAt: '2026-11-01T00:00:00Z' },
    )[0];
    expect(full.tone).toBe('warn');
    expect(full.body).toContain(`$${CORPORATE_PLAN.extraEventPrice}`);
    expect(full.body).toContain('come back');
  });

  it('shows nothing extra on an ordinary paid event', () => {
    expect(eventStatusNotices({ tier: 'plus', paid: true })).toEqual([]);
  });
});

describe('reading a counter row', () => {
  it('parses each kind of id create-event and the guest book write', () => {
    expect(quotaKind('trial-day#2026-10-01')).toEqual({ kind: 'trial-day', day: '2026-10-01' });
    expect(quotaKind('corporate-month#abc-123#2026-10')).toEqual({
      kind: 'corporate-month',
      hostSub: 'abc-123',
      month: '2026-10',
    });
    expect(quotaKind('guestbook#ev1#guest#us-east-1:xyz')).toEqual({
      kind: 'guestbook-guest',
      eventId: 'ev1',
      who: 'us-east-1:xyz',
    });
    expect(quotaKind('guestbook#ev1#ip#203.0.113.9')).toEqual({
      kind: 'guestbook-address',
      eventId: 'ev1',
      address: '203.0.113.9',
    });
    for (const junk of [
      '',
      'corporate-month#x#2026-1',
      'corporate-month##2026-10',
      'corporate-seat#x#0',
      'guestbook#ev#other#x',
      'nope',
    ]) {
      expect(quotaKind(junk).kind).toBe('unknown');
    }
  });

  it('builds today’s id in UTC, the way create-event does', () => {
    expect(trialDayId(new Date('2026-10-01T23:30:00-05:00'))).toBe('trial-day#2026-10-02');
  });

  it('uses the same default daily allowance as create-event', () => {
    const handler = codeOnly(readSource('amplify/functions/create-event/handler.ts'));
    expect(handler).toContain(
      `const DEFAULT_FREE_EVENTS_PER_DAY: number | null = ${DEFAULT_FREE_EVENTS_PER_DAY};`,
    );
  });

  it('lists only this month’s Corporate counters that have been used', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    expect(corporateMonthInUse({ id: 'corporate-month#s#2026-10', count: 3 }, now)).toBe(true);
    expect(corporateMonthInUse({ id: 'corporate-month#s#2026-09', count: 10 }, now)).toBe(false);
    expect(corporateMonthInUse({ id: 'corporate-month#s#2026-10', count: 0 }, now)).toBe(false);
    expect(corporateMonthInUse({ id: 'trial-day#2026-10-15', count: 3 }, now)).toBe(false);
  });

  it('flags a guest book counter only once it is refusing notes', () => {
    expect(
      guestBookLimitReached({ id: 'guestbook#e#guest#g', count: MAX_ENTRIES_PER_GUEST }),
    ).toBe(true);
    expect(
      guestBookLimitReached({ id: 'guestbook#e#guest#g', count: MAX_ENTRIES_PER_GUEST - 1 }),
    ).toBe(false);
    expect(
      guestBookLimitReached({ id: 'guestbook#e#ip#1.2.3.4', count: MAX_ENTRIES_PER_ADDRESS }),
    ).toBe(true);
    expect(guestBookLimitReached({ id: 'trial-day#2026-10-01', count: 999 })).toBe(false);
  });
});

describe('wiring', () => {
  const dashboard = readSource('pages/event/[eventId]/admin.tsx');
  const admin = readSource('pages/global-admin.tsx');

  it('renders the notices on the host dashboard and pays through the normal checkout', () => {
    expect(dashboard).toContain('<EventStatusNotices');
    expect(dashboard).toContain('startCheckout(event.tier, event.id)');
  });

  it('hides the Featured Events offer on a free event', () => {
    expect(dashboard).toContain('photos.length > 0 && !isTrialTier(event.tier)');
  });

  it('lets a discount code target the Corporate extra event', () => {
    expect(admin).toContain("{ key: 'event:corporate', label: 'Corporate extra event' }");
    expect(admin).toContain("{ key: 'event:plus', label: 'Full Event' }");
  });

  it('shows today’s free events and the limits list', () => {
    expect(admin).toContain('Free events per day');
    expect(admin).toContain('<FreeEventsChart series={series} />');
    expect(admin).toContain('id="limits"');
    expect(admin).toContain('clearQuotaCounter');
  });

  it('only ever reads the caller’s own monthly count', () => {
    const seats = codeOnly(readSource('amplify/functions/corporate-seats/handler.ts'));
    expect(seats).toContain('event.identity');
    expect(seats).toContain('`corporate-month#${sub}#${now.toISOString().slice(0, 7)}`');
    expect(seats).not.toContain('event.arguments');
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain('quotaTable.grantReadData(corporateSeatsFn)');
    expect(backend).not.toContain('quotaTable.grantReadWriteData(corporateSeatsFn)');
  });
});
