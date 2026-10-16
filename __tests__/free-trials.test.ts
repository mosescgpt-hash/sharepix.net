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

describe('account emails on the free trials tab', () => {
  // Imported here so the describe above stays about the list itself.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lookup = require('../amplify/functions/account-emails/lookup');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ownerSub } = require('../lib/freeTrials');
  const SUB = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('reads the sub out of an owner string, old or new', () => {
    expect(ownerSub(`${SUB}::${SUB}`)).toBe(SUB);
    expect(ownerSub(SUB.toUpperCase())).toBe(SUB);
    expect(ownerSub(null)).toBe('');
  });

  it('accepts only distinct, well-formed subs, capped', () => {
    expect(lookup.requestedSubs([SUB, SUB.toUpperCase(), 'x"; drop', '', null])).toEqual([SUB]);
    const many = Array.from({ length: lookup.MAX_SUBS + 10 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );
    expect(lookup.requestedSubs(many)).toHaveLength(lookup.MAX_SUBS);
  });

  it('pairs sub and email from Cognito attributes', () => {
    expect(
      lookup.subAndEmail([
        { Name: 'sub', Value: SUB },
        { Name: 'email', Value: 'host@example.com' },
      ]),
    ).toEqual({ sub: SUB, email: 'host@example.com' });
    expect(lookup.subAndEmail([{ Name: 'sub', Value: SUB }])).toBeNull();
  });

  it('is admin-only, and can read accounts but never change them', () => {
    const schema = readSource('amplify/data/resource.ts');
    const query = schema.slice(schema.indexOf('accountEmails: a'), schema.indexOf('checkPrintProvider: a'));
    expect(query).toContain("allow.group('ADMINS')");
    expect(query).not.toContain('allow.authenticated()');
    const backend = readSource('amplify/backend.ts');
    const grant = backend.slice(backend.indexOf('const accountEmailsFn'), backend.indexOf('// Stripe webhook'));
    expect(grant).toContain("actions: ['cognito-idp:ListUsers']");
  });
});
