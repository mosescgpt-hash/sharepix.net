import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOT_MEASURED,
  delta,
  figuresFor,
  headline,
  monthLabel,
  reportLines,
  reportMonths,
  type ReportEvent,
} from '../lib/monthlyReport';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

const NOW = new Date('2026-10-03T15:00:00.000Z');
const SEPT = (day: number) => `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const AUG = (day: number) => `2026-08-${String(day).padStart(2, '0')}T12:00:00.000Z`;

/** An event that clears both Successful Event thresholds. */
const winner = (createdAt: string, extra: Partial<ReportEvent> = {}): ReportEvent => ({
  createdAt,
  tier: 'plus',
  contributorCount: 5,
  guestUploadCount: 40,
  ...extra,
});
/** An event that does not. */
const quiet = (createdAt: string, extra: Partial<ReportEvent> = {}): ReportEvent => ({
  createdAt,
  tier: 'plus',
  contributorCount: 1,
  guestUploadCount: 2,
  ...extra,
});

describe('the copies have not drifted', () => {
  it.each(['monthlyReport', 'attribution', 'successfulEvent'])(
    'keeps the function copy of %s byte-identical',
    (name) => {
      expect(bodyOf(read(`amplify/functions/monthly-report/${name}.ts`))).toBe(
        bodyOf(read(`lib/${name}.ts`)),
      );
    },
  );
});

describe('which month it reports on', () => {
  it('covers the calendar month that has finished, not the one running', () => {
    // Running on the 1st and reporting the month just ended means every figure
    // is final. A report covering a month in progress invites comparing eleven
    // days against thirty.
    const { current, previous } = reportMonths(NOW);
    expect(current.label).toBe('September 2026');
    expect(previous.label).toBe('August 2026');
    expect(current.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(current.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('rolls back over a year boundary', () => {
    const { current, previous } = reportMonths(new Date('2027-01-01T15:00:00.000Z'));
    expect(current.label).toBe('December 2026');
    expect(previous.label).toBe('November 2026');
  });

  it('writes the month out rather than in digits', () => {
    expect(monthLabel(new Date('2026-09-01T00:00:00Z'))).toBe('September 2026');
  });
});

describe('the figures', () => {
  const { current, previous } = reportMonths(NOW);
  const events: ReportEvent[] = [
    winner(SEPT(2), { source: 'guest_upload' }),
    winner(SEPT(9)),
    quiet(SEPT(20), { tier: 'free' }),
    // Different month — must not leak in.
    winner(AUG(14)),
  ];

  it('counts only the month being reported', () => {
    const figures = figuresFor(events, [], current);
    expect(figures.eventsCreated).toBe(3);
    expect(figuresFor(events, [], previous).eventsCreated).toBe(1);
  });

  it('separates paid from free', () => {
    const figures = figuresFor(events, [], current);
    expect(figures.paidEvents).toBe(2);
    expect(figures.freeEvents).toBe(1);
  });

  it('uses the shared Successful Event definition', () => {
    const figures = figuresFor(events, [], current);
    expect(figures.successfulEvents).toBe(2);
    expect(figures.successRate).toBe(66.7);
  });

  it('reports the success rate as null, not zero, with no events', () => {
    // "0.0% of events succeeded" reads as a catastrophe rather than as an
    // empty month.
    expect(figuresFor([], [], current).successRate).toBeNull();
  });

  it('counts hosts who were somebody else’s guest first', () => {
    expect(figuresFor(events, [], current).fromGuestUpload).toBe(1);
  });

  it('reports gift cards owed now, not owed that month', () => {
    // An unpaid obligation is a present fact, and the point of putting it in a
    // monthly email is that somebody notices it is still sitting there.
    const incentives = [
      { status: 'AWAITING_MANUAL_FULFILLMENT', amountUsd: 25, completedAt: SEPT(5) },
      { status: 'AWAITING_MANUAL_FULFILLMENT', amountUsd: 25, completedAt: AUG(5) },
      { status: 'FULFILLED', amountUsd: 25, completedAt: SEPT(6) },
    ];
    const figures = figuresFor(events, incentives, current);
    expect(figures.rewardsOwedUsd).toBe(50);
    // Completions, unlike what is owed, are counted within the month.
    expect(figures.surveysCompleted).toBe(2);
  });
});

describe('month-over-month change', () => {
  it('shows a percentage when there is something to compare against', () => {
    expect(delta(12, 10)).toBe('+20%');
    expect(delta(8, 10)).toBe('-20%');
    expect(delta(10, 10)).toBe('no change');
  });

  it('says nothing at all when the previous month was zero', () => {
    // A change from nothing is not a percentage. "+100%" against a base of zero
    // reads as growth when it means "one thing happened".
    expect(delta(5, 0)).toBe('');
    expect(delta(0, 0)).toBe('');
  });

  it('puts a change beside every line it can', () => {
    const { current, previous } = reportMonths(NOW);
    const events = [...Array(12)].map((_, i) => winner(SEPT(i + 1)));
    const before = [...Array(10)].map((_, i) => winner(AUG(i + 1)));
    const lines = reportLines(
      figuresFor([...events, ...before], [], current),
      figuresFor([...events, ...before], [], previous),
    );
    expect(lines.find((l) => l.label === 'Events created')?.change).toBe('+20%');
  });
});

describe('the headline', () => {
  const { current, previous } = reportMonths(NOW);
  const figures = (events: ReportEvent[], range = current) => figuresFor(events, [], range);

  it('says so plainly when nothing has happened at all', () => {
    expect(headline(figures([]), figures([], previous))).toMatch(/nothing has happened/i);
  });

  it('refuses to call a trend on a handful of events', () => {
    // A monthly email that declares a trend from two events to three is noise
    // wearing a suit, and the cost of a wrong headline is that the right one
    // stops being believed.
    const now = figures([winner(SEPT(1)), winner(SEPT(2)), quiet(SEPT(3))]);
    const then = figures([winner(AUG(1))], previous);
    expect(headline(now, then)).toMatch(/too few/i);
  });

  it('calls out a real drop in successful events once there is enough data', () => {
    const septEvents = [
      ...[...Array(3)].map((_, i) => winner(SEPT(i + 1))),
      ...[...Array(9)].map((_, i) => quiet(SEPT(i + 4))),
    ];
    const augEvents = [...Array(12)].map((_, i) => winner(AUG(i + 1)));
    const all = [...septEvents, ...augEvents];
    const line = headline(figures(all), figures(all, previous));
    expect(line).toMatch(/down/i);
    expect(line).toMatch(/before anything else/i);
  });
});

describe('what the report refuses to pretend it knows', () => {
  it('names what is not measured, rather than printing zeros', () => {
    // A report that renders "Visitors: 0. Refunds: 0. CAC: $0.00" makes every
    // other figure on the page suspect, and within two months nobody opens it.
    expect(NOT_MEASURED.length).toBeGreaterThan(0);
    const joined = NOT_MEASURED.join(' ').toLowerCase();
    for (const absent of ['visitor', 'chargeback', 'experiment', 'referral', 'support']) {
      expect(joined).toContain(absent);
    }
  });

  it('has stopped claiming refunds are unmeasured, now that they are', () => {
    // The list shrinking is the signal. Refunds moved onto the ledger, so they
    // moved off this list — but chargebacks did not, because no dispute data
    // comes back from Stripe, and lumping them together would quietly claim
    // coverage we do not have.
    const joined = NOT_MEASURED.join(' ').toLowerCase();
    expect(joined).not.toMatch(/\brefunds and\b/);
    expect(joined).toContain('chargeback');
  });

  it('has no line for anything unmeasured', () => {
    const { current, previous } = reportMonths(NOW);
    const lines = reportLines(figuresFor([], [], current), figuresFor([], [], previous));
    const labels = lines.map((l) => l.label.toLowerCase()).join(' ');
    for (const absent of ['visitor', 'chargeback', 'cac', 'experiment', 'referral']) {
      expect(labels).not.toContain(absent);
    }
  });

  it('does have a refunds line, because the ledger measures them', () => {
    const { current, previous } = reportMonths(NOW);
    const refunds = [
      { status: 'RECORDED', amountCents: 7900, createdAt: SEPT(4) },
      { status: 'REQUESTED', amountCents: 7900, createdAt: SEPT(9) },
    ];
    const figures = figuresFor([], [], current, refunds);
    // Only committed money counts; a claim nobody has answered is not a refund.
    expect(figures.refundedCents).toBe(7900);
    expect(figures.refundsAwaitingDecision).toBe(1);
    const lines = reportLines(figures, figuresFor([], [], previous, refunds));
    expect(lines.find((l) => l.label === 'Refunded')?.value).toBe('$79.00');
  });

  it('says why each one is absent', () => {
    for (const item of NOT_MEASURED) expect(item).toMatch(/—/);
  });
});

describe('the scheduled function', () => {
  const resource = read('amplify/functions/monthly-report/resource.ts');
  const handler = read('amplify/functions/monthly-report/handler.ts');
  const backend = read('amplify/backend.ts');

  it('runs on the first of the month at a fixed hour', () => {
    expect(resource).toContain("schedule: '0 15 1 * ? *'");
  });

  it('sends nothing until a recipient is configured', () => {
    expect(handler).toContain('if (!TO_ADDRESS || !FROM_ADDRESS)');
    expect(handler).toContain('[dry-run]');
  });

  it('can only read', () => {
    // A job running unattended against every row once a month has no reason to
    // be able to change any of it.
    expect(backend).toContain('eventTable.grantReadData(monthlyReportFn)');
    expect(backend).toContain('incentiveTable.grantReadData(monthlyReportFn)');
    expect(backend).not.toContain('grantReadWriteData(monthlyReportFn)');
    expect(backend).not.toContain('grantWriteData(monthlyReportFn)');
  });

  it('aliases the reserved words it projects', () => {
    // `source` and `status` are both reserved in DynamoDB expressions, and a
    // scan that names them raw fails at runtime and nowhere else.
    expect(handler).toContain("{ '#source': 'source' }");
    expect(handler).toContain("{ '#status': 'status' }");
  });
});
