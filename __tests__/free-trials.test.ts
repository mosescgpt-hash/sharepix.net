import { countCreatedWithin, freeTrialEvents } from '../lib/freeTrials';
import type { QREvent } from '../lib/types';
import { readSource } from './sourceGuards';

const event = (id: string, tier: string, createdAt?: string): QREvent =>
  ({ id, name: id, eventCode: id, tier, createdAt }) as QREvent;

describe('free trials tab', () => {
  const events = [
    event('paid', 'plus', '2026-10-06T00:00:00Z'),
    event('old-trial', 'trial', '2026-09-01T00:00:00Z'),
    event('retired-free', 'free', '2026-08-01T00:00:00Z'),
    event('new-trial', 'trial', '2026-10-06T00:00:00Z'),
  ];

  it('lists only trial events, current and retired, newest first', () => {
    expect(freeTrialEvents(events).map((e) => e.id)).toEqual([
      'new-trial',
      'old-trial',
      'retired-free',
    ]);
  });

  it('counts recent ones', () => {
    const now = new Date('2026-10-07T00:00:00Z');
    const trials = freeTrialEvents(events);
    expect(countCreatedWithin(trials, 7, now)).toBe(1);
    expect(countCreatedWithin(trials, 60, now)).toBe(2);
  });

  it('has its own tab, with the free event controls beside the list', () => {
    const page = readSource('pages/global-admin.tsx');
    expect(page).toContain("{ id: 'free-trials', label: 'Free trial events', tab: 'trials' }");
    expect(page).toContain("{ id: 'free-claims', label: 'Free event claims', tab: 'trials' }");
  });
});
