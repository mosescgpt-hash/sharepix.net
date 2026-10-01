import {
  DEFAULT_FREE_EVENTS_PER_DAY,
  FREE_EVENTS_SETTING_KEY,
  MAX_FREE_EVENTS_PER_DAY,
  freeEventAdvice,
  freeEventSeries,
  parseDailyLimit,
  type FreeEventDay,
} from '../lib/quotaCounters';
import { codeOnly, readSource } from './sourceGuards';

/**
 * The daily free-event limit as an admin setting, and the chart that says when
 * to move it.
 */

const handler = codeOnly(readSource('amplify/functions/create-event/handler.ts'));

describe('the setting', () => {
  it('accepts 0 to the maximum, whole numbers only', () => {
    expect(parseDailyLimit('25')).toBe(25);
    expect(parseDailyLimit(' 0 ')).toBe(0);
    expect(parseDailyLimit(String(MAX_FREE_EVENTS_PER_DAY))).toBe(MAX_FREE_EVENTS_PER_DAY);
    for (const bad of ['', '-1', '2.5', '1e3', 'ten', String(MAX_FREE_EVENTS_PER_DAY + 1), null]) {
      expect(parseDailyLimit(bad)).toBeNull();
    }
  });

  it('is the same key, default and maximum on the dashboard and in create-event', () => {
    expect(readSource('lib/api.ts')).toContain(
      `freeEventsPerDay: '${FREE_EVENTS_SETTING_KEY}'`,
    );
    expect(handler).toContain(`const FREE_EVENTS_SETTING_KEY = '${FREE_EVENTS_SETTING_KEY}';`);
    expect(handler).toContain(`const DEFAULT_FREE_EVENTS_PER_DAY = ${DEFAULT_FREE_EVENTS_PER_DAY};`);
    expect(handler).toContain(`const MAX_FREE_EVENTS_PER_DAY = ${MAX_FREE_EVENTS_PER_DAY};`);
  });

  it('is read on every free-event request, so a change applies at once', () => {
    const take = handler.slice(
      handler.indexOf('async function takeTrialAllowance'),
      handler.indexOf('async function countRefusal'),
    );
    expect(take).toContain('const cap = await freeEventsPerDay();');
  });

  it('counts the requests it turns away', () => {
    expect(handler).toContain('await countRefusal(nowISO, cap);');
    expect(handler).toContain("'ADD #refused :one");
  });

  it('can be read by create-event and nothing more', () => {
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain('settingTable.grantReadData(createEventFn)');
    expect(backend).not.toContain('settingTable.grantReadWriteData(createEventFn)');
  });
});

describe('the series', () => {
  const now = new Date('2026-10-01T15:00:00Z');

  it('has one entry per day, oldest first, ending today, with quiet days as zero', () => {
    const series = freeEventSeries(
      [
        { id: 'trial-day#2026-10-01', count: 4, limit: 25 },
        { id: 'trial-day#2026-09-29', count: 25, limit: 25, refused: 3 },
        { id: 'corporate-seat#x#0', count: 99 },
      ],
      30,
      now,
    );
    expect(series).toHaveLength(30);
    expect(series[0].day).toBe('2026-09-02');
    expect(series[29]).toEqual({ day: '2026-10-01', given: 4, refused: 0, limit: 25 });
    expect(series[27]).toEqual({ day: '2026-09-29', given: 25, refused: 3, limit: 25 });
    expect(series[28]).toEqual({ day: '2026-09-30', given: 0, refused: 0, limit: null });
  });
});

describe('the advice', () => {
  const quiet = (n: number): FreeEventDay[] =>
    Array.from({ length: n }, (_, i) => ({ day: `d${i}`, given: 3, refused: 0, limit: 25 }));

  it('says to look at raising it when people were turned away this week', () => {
    const series = quiet(30);
    series[28] = { day: 'x', given: 25, refused: 6, limit: 25 };
    const advice = freeEventAdvice(series, 25);
    expect(advice.tone).toBe('warn');
    expect(advice.message).toContain('1 of the last 7 days');
    expect(advice.message).toContain('6 requests');
    // Never "raise it" without the abuse caveat.
    expect(advice.message).toMatch(/one person with many email addresses/);
  });

  it('notices a day that filled up even with nobody refused yet', () => {
    const series = quiet(30);
    series[29] = { day: 'x', given: 25, refused: 0, limit: 25 };
    expect(freeEventAdvice(series, 25).tone).toBe('warn');
  });

  it('flags getting close, and says when there is plenty of room', () => {
    const close = quiet(30);
    close[10] = { day: 'x', given: 21, refused: 0, limit: 25 };
    expect(freeEventAdvice(close, 25).message).toMatch(/Close to the limit/);
    expect(freeEventAdvice(quiet(30), 25).message).toMatch(/Plenty of room/);
  });

  it('says plainly when free events are paused', () => {
    expect(freeEventAdvice(quiet(30), 0).message).toMatch(/paused/);
  });
});
