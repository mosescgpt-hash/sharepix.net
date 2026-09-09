import {
  filterSurveys,
  flagsFor,
  readSurveyRow,
  sortSurveys,
  stageOf,
  summarise,
  type SurveyRow,
} from '../lib/surveyAdmin';
import { SURVEY_QUESTIONS } from '../lib/survey';

const ANSWER_IDS = SURVEY_QUESTIONS.map((q) => q.id);

function row(overrides: Partial<SurveyRow> = {}): SurveyRow {
  return {
    id: 'ev-1',
    eventId: 'ev-1',
    eventName: 'Sam and Ada',
    customer: 'host@example.com',
    surveyVersion: 'v1.0',
    requestedAt: '2026-06-04T00:00:00Z',
    startedAt: null,
    completedAt: null,
    reminderSentAt: null,
    answers: {},
    metrics: null,
    ...overrides,
  };
}

describe('what stage a response is at', () => {
  it('is invited until somebody opens it', () => {
    expect(stageOf(row())).toBe('invited');
  });

  it('is started once opened and not finished', () => {
    expect(stageOf(row({ startedAt: '2026-06-05T00:00:00Z' }))).toBe('started');
  });

  it('is completed once submitted, whatever else is set', () => {
    expect(stageOf(row({ startedAt: null, completedAt: '2026-06-06T00:00:00Z' }))).toBe(
      'completed',
    );
  });
});

describe('research flags', () => {
  it('says nothing about an unfinished response', () => {
    // A half-answered survey has a low score in the same sense an empty form
    // does. Flagging it would put noise at the top of the list the flags exist
    // to prioritise.
    expect(flagsFor(row({ startedAt: '2026-06-05T00:00:00Z', answers: { satisfaction: 1 } })))
      .toEqual([]);
  });

  it('flags a finished response worth reading', () => {
    const flags = flagsFor(
      row({ completedAt: '2026-06-06T00:00:00Z', answers: { satisfaction: 2, npsScore: 3 } }),
    );
    expect(flags).toEqual(expect.arrayContaining(['low-satisfaction', 'low-nps']));
  });

  it('says nothing about a happy finished response', () => {
    expect(
      flagsFor(row({ completedAt: '2026-06-06T00:00:00Z', answers: { satisfaction: 5, npsScore: 10 } })),
    ).toEqual([]);
  });
});

describe('filtering', () => {
  const invited = row({ id: 'a', eventName: 'Alpha' });
  const started = row({ id: 'b', eventName: 'Bravo', startedAt: '2026-06-05T00:00:00Z' });
  const done = row({
    id: 'c',
    eventName: 'Charlie',
    completedAt: '2026-06-10T12:00:00Z',
    answers: {
      satisfaction: 2,
      npsScore: 4,
      wouldPay: 'probably-not',
      eventType: 'wedding',
      testimonialPermission: 'no',
      photoMarketingInterest: 'yes',
      worstPart: 'The upload page confused several of my guests badly.',
    },
    metrics: { internalCohort: 'FOUNDING_20', eventType: 'wedding' } as SurveyRow['metrics'],
  });
  const all = [invited, started, done];

  it('narrows by nothing when nothing is set', () => {
    // An empty dashboard because a control defaulted to a value nobody chose is
    // the failure worth avoiding.
    expect(filterSurveys(all, {})).toHaveLength(3);
    expect(filterSurveys(all, { stage: 'all', eventType: 'all', wouldPay: 'all' })).toHaveLength(3);
  });

  it('narrows by stage', () => {
    expect(filterSurveys(all, { stage: 'completed' }).map((r) => r.id)).toEqual(['c']);
    expect(filterSurveys(all, { stage: 'invited' }).map((r) => r.id)).toEqual(['a']);
    expect(filterSurveys(all, { stage: 'started' }).map((r) => r.id)).toEqual(['b']);
  });

  it('narrows to the flagged ones', () => {
    expect(filterSurveys(all, { flaggedOnly: true }).map((r) => r.id)).toEqual(['c']);
  });

  it('narrows by event type', () => {
    expect(filterSurveys(all, { eventType: 'wedding' }).map((r) => r.id)).toEqual(['c']);
    expect(filterSurveys(all, { eventType: 'birthday' })).toEqual([]);
  });

  it('narrows by internal cohort', () => {
    expect(filterSurveys(all, { cohort: 'FOUNDING_20' }).map((r) => r.id)).toEqual(['c']);
  });

  it('narrows by satisfaction at or below a score', () => {
    expect(filterSurveys(all, { maxSatisfaction: 3 }).map((r) => r.id)).toEqual(['c']);
    expect(filterSurveys(all, { maxSatisfaction: 1 })).toEqual([]);
  });

  it('narrows by NPS at or below a score', () => {
    expect(filterSurveys(all, { maxNps: 6 }).map((r) => r.id)).toEqual(['c']);
    expect(filterSurveys(all, { maxNps: 3 })).toEqual([]);
  });

  it('excludes an unanswered score rather than treating it as zero', () => {
    // The unfinished rows have no satisfaction at all; a filter for "3 or
    // below" must not sweep them in as though they had answered badly.
    expect(filterSurveys(all, { maxSatisfaction: 5 }).map((r) => r.id)).toEqual(['c']);
  });

  it('narrows by the permission answers', () => {
    expect(filterSurveys(all, { testimonialPermission: 'no' }).map((r) => r.id)).toEqual(['c']);
    expect(filterSurveys(all, { testimonialPermission: 'named' })).toEqual([]);
    expect(filterSurveys(all, { photoMarketingInterest: 'yes' }).map((r) => r.id)).toEqual(['c']);
  });

  it('narrows by willingness to pay', () => {
    expect(filterSurveys(all, { wouldPay: 'probably-not' }).map((r) => r.id)).toEqual(['c']);
  });

  it('searches the written answers, not just the names', () => {
    expect(filterSurveys(all, { search: 'confused' }).map((r) => r.id)).toEqual(['c']);
    expect(filterSurveys(all, { search: 'Bravo' }).map((r) => r.id)).toEqual(['b']);
    expect(filterSurveys(all, { search: 'nothing here' })).toEqual([]);
  });

  it('ignores case and surrounding space in the search', () => {
    expect(filterSurveys(all, { search: '  CONFUSED  ' }).map((r) => r.id)).toEqual(['c']);
  });

  describe('date range', () => {
    it('includes a response finished on the end date', () => {
      // A bare YYYY-MM-DD end would otherwise exclude everything answered that
      // day, which is not what picking that day means.
      expect(
        filterSurveys(all, { from: '2026-06-01', to: '2026-06-10' }).map((r) => r.id),
      ).toEqual(['c']);
    });

    it('excludes one finished outside it', () => {
      expect(filterSurveys(all, { from: '2026-07-01' })).toEqual([]);
    });

    it('excludes unfinished responses from every range', () => {
      // They were never finished, so they are outside any window rather than
      // inside all of them.
      expect(filterSurveys(all, { from: '2020-01-01' }).map((r) => r.id)).toEqual(['c']);
    });
  });

  it('applies several filters together', () => {
    expect(
      filterSurveys(all, { stage: 'completed', maxNps: 6, wouldPay: 'probably-not' }).map(
        (r) => r.id,
      ),
    ).toEqual(['c']);
    expect(filterSurveys(all, { stage: 'completed', wouldPay: 'definitely-yes' })).toEqual([]);
  });
});

describe('ordering', () => {
  it('puts finished responses first, newest of those at the top', () => {
    const rows = [
      row({ id: 'old', completedAt: '2026-05-01T00:00:00Z' }),
      row({ id: 'waiting', requestedAt: '2026-06-01T00:00:00Z' }),
      row({ id: 'new', completedAt: '2026-06-20T00:00:00Z' }),
    ];
    expect(sortSurveys(rows).map((r) => r.id)).toEqual(['new', 'old', 'waiting']);
  });

  it('does not mutate what it is given', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', completedAt: '2026-06-01T00:00:00Z' })];
    sortSurveys(rows);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('the numbers above the table', () => {
  it('counts each stage', () => {
    const summary = summarise([
      row({ id: 'a' }),
      row({ id: 'b', startedAt: '2026-06-05T00:00:00Z' }),
      row({ id: 'c', completedAt: '2026-06-06T00:00:00Z', answers: { satisfaction: 5, npsScore: 10 } }),
    ]);
    expect(summary).toMatchObject({ invited: 3, started: 1, completed: 1, responseRate: 33 });
  });

  it('averages satisfaction to one decimal', () => {
    const summary = summarise([
      row({ id: 'a', completedAt: 'x', answers: { satisfaction: 4 } }),
      row({ id: 'b', completedAt: 'x', answers: { satisfaction: 5 } }),
      row({ id: 'c', completedAt: 'x', answers: { satisfaction: 4 } }),
    ]);
    expect(summary.meanSatisfaction).toBe(4.3);
  });

  it('reports NPS as promoters minus detractors', () => {
    const summary = summarise([
      row({ id: 'a', completedAt: 'x', answers: { npsScore: 10 } }),
      row({ id: 'b', completedAt: 'x', answers: { npsScore: 9 } }),
      row({ id: 'c', completedAt: 'x', answers: { npsScore: 8 } }),
      row({ id: 'd', completedAt: 'x', answers: { npsScore: 2 } }),
    ]);
    expect(summary.nps).toBe(25);
  });

  it('is null rather than zero when nothing has been answered', () => {
    // "NPS 0" for an empty programme states a measured result, and a reader who
    // believes it once stops believing the rest of the page.
    const summary = summarise([row({ id: 'a' })]);
    expect(summary.nps).toBeNull();
    expect(summary.meanSatisfaction).toBeNull();
    expect(summary.responseRate).toBe(0);
  });

  it('has no response rate at all when nobody was invited', () => {
    expect(summarise([]).responseRate).toBeNull();
  });

  it('counts willingness to pay only among those who answered it', () => {
    const summary = summarise([
      row({ id: 'a', completedAt: 'x', answers: { wouldPay: 'definitely-yes' } }),
      row({ id: 'b', completedAt: 'x', answers: { wouldPay: 'probably-not' } }),
      row({ id: 'c', completedAt: 'x', answers: {} }),
    ]);
    expect(summary.wouldPayYes).toBe(1);
    expect(summary.wouldPayAnswered).toBe(2);
  });

  it('ignores unfinished responses in every average', () => {
    const summary = summarise([
      row({ id: 'a', startedAt: 'x', answers: { satisfaction: 1 } }),
      row({ id: 'b', completedAt: 'x', answers: { satisfaction: 5 } }),
    ]);
    expect(summary.meanSatisfaction).toBe(5);
  });
});

describe('reading a stored row', () => {
  it('picks up answers of every shape', () => {
    const parsed = readSurveyRow(
      {
        id: 'ev-1',
        eventName: 'Sam and Ada',
        satisfaction: 4,
        bestPart: 'The QR code',
        discoveryChannels: ['qr-sign', 'table-cards'],
      },
      ANSWER_IDS,
    );
    expect(parsed.answers).toEqual({
      satisfaction: 4,
      bestPart: 'The QR code',
      discoveryChannels: ['qr-sign', 'table-cards'],
    });
  });

  it('ignores attributes that are not answers', () => {
    const parsed = readSurveyRow({ id: 'ev-1', surveyToken: 'secret' }, ANSWER_IDS);
    expect(parsed.answers).toEqual({});
    // The token proves who was invited; it has no business on a screen.
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });

  it('reads the metrics snapshot back, and tolerates a missing one', () => {
    const withMetrics = readSurveyRow(
      { id: 'ev-1', metricsJson: JSON.stringify({ photoCount: 400 }) },
      ANSWER_IDS,
    );
    expect(withMetrics.metrics?.photoCount).toBe(400);
    expect(readSurveyRow({ id: 'ev-1' }, ANSWER_IDS).metrics).toBeNull();
    expect(readSurveyRow({ id: 'ev-1', metricsJson: '{bad' }, ANSWER_IDS).metrics).toBeNull();
  });

  it('leaves a null answer out rather than storing it as null', () => {
    const parsed = readSurveyRow({ id: 'ev-1', satisfaction: null, bestPart: undefined }, ANSWER_IDS);
    expect(parsed.answers).toEqual({});
  });
});
