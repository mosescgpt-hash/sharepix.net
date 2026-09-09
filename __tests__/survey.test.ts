import {
  MAX_OTHER_TEXT_LENGTH,
  MAX_TEXT_ANSWER_LENGTH,
  SURVEY_DAYS_AFTER_ACQUISITION,
  SURVEY_DAYS_AFTER_EVENT_DATE,
  SURVEY_QUESTIONS,
  SURVEY_REMINDER_DAYS,
  SURVEY_SECTIONS,
  SURVEY_VERSION,
  cleanAnswers,
  isQuestionVisible,
  netPromoterScore,
  npsBucket,
  progressLabel,
  questionsInSection,
  reminderIsDue,
  researchFlags,
  surveyDueAt,
  surveyIsDue,
} from '../lib/survey';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('the question set', () => {
  it('asks twenty-four questions across five sections', () => {
    expect(SURVEY_QUESTIONS).toHaveLength(24);
    expect(SURVEY_SECTIONS).toHaveLength(5);
    expect(new Set(SURVEY_QUESTIONS.map((q) => q.section))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('gives every question a unique, stable id', () => {
    const ids = SURVEY_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Answers are stored under these, so an empty or whitespace id would write
    // to an unaddressable attribute.
    for (const id of ids) expect(id.trim()).toBe(id);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });

  it('never ends an id with Other, which is the free-text suffix', () => {
    // cleanAnswers treats `<id>Other` as the companion text box, so a question
    // genuinely called somethingOther would be silently swallowed.
    for (const question of SURVEY_QUESTIONS) {
      expect(question.id.endsWith('Other')).toBe(false);
    }
  });

  it('gives choice questions options and scale questions a range', () => {
    for (const question of SURVEY_QUESTIONS) {
      if (question.kind === 'single' || question.kind === 'multi') {
        expect(question.options?.length ?? 0).toBeGreaterThan(1);
        const values = (question.options ?? []).map((o) => o.value);
        expect(new Set(values).size).toBe(values.length);
      }
      if (question.kind === 'scale' || question.kind === 'nps') {
        expect(question.scale).toBeDefined();
        expect(question.scale!.max).toBeGreaterThan(question.scale!.min);
      }
    }
  });

  it('scores NPS zero to ten and satisfaction one to five', () => {
    const nps = SURVEY_QUESTIONS.find((q) => q.id === 'npsScore');
    expect(nps?.scale).toEqual({ min: 0, max: 10, minLabel: expect.any(String), maxLabel: expect.any(String) });
    const satisfaction = SURVEY_QUESTIONS.find((q) => q.id === 'satisfaction');
    expect(satisfaction?.scale?.min).toBe(1);
    expect(satisfaction?.scale?.max).toBe(5);
  });

  it('offers only features the product actually has', () => {
    const features = SURVEY_QUESTIONS.find((q) => q.id === 'valuableFeatures');
    const values = (features?.options ?? []).map((o) => o.value);
    // Missions / photo challenges do not exist in SharePix. Asking about them
    // collects data about nothing and tells a customer we ship something we do
    // not.
    expect(values).not.toContain('missions');
    expect(values).toContain('guest-book');
    expect(values).toContain('slideshow');
    expect(values).toContain('moments');
  });

  it('keeps the permission questions out of the product sections', () => {
    for (const id of ['followUpPermission', 'testimonialPermission', 'photoMarketingInterest']) {
      expect(SURVEY_QUESTIONS.find((q) => q.id === id)?.section).toBe(5);
    }
  });

  it('orders sections one to five with no gaps', () => {
    expect(SURVEY_SECTIONS.map((s) => s.index)).toEqual([1, 2, 3, 4, 5]);
    for (const section of SURVEY_SECTIONS) {
      expect(questionsInSection(section.index).length).toBeGreaterThan(0);
    }
  });

  it('labels progress by section', () => {
    expect(progressLabel(1)).toBe('1 of 5');
    expect(progressLabel(5)).toBe('5 of 5');
  });
});

describe('conditional questions', () => {
  const confusion = SURVEY_QUESTIONS.find((q) => q.id === 'guestConfusion')!;

  it('hides the follow-up while nothing has been answered', () => {
    expect(isQuestionVisible(confusion, {})).toBe(false);
    expect(isQuestionVisible(confusion, { guestHelpNeeded: '' })).toBe(false);
  });

  it('stays hidden when no guest needed help', () => {
    expect(isQuestionVisible(confusion, { guestHelpNeeded: 'no' })).toBe(false);
  });

  it('appears once somebody did need help', () => {
    expect(isQuestionVisible(confusion, { guestHelpNeeded: 'several' })).toBe(true);
  });

  it('leaves unconditional questions always visible', () => {
    const best = SURVEY_QUESTIONS.find((q) => q.id === 'bestPart')!;
    expect(isQuestionVisible(best, {})).toBe(true);
  });
});

describe('cleanAnswers', () => {
  it('keeps a well-formed set intact', () => {
    const { answers, rejected } = cleanAnswers({
      satisfaction: 4,
      npsScore: 9,
      wouldPay: 'probably-yes',
      bestPart: 'The QR code just worked.',
      discoveryChannels: ['qr-sign', 'table-cards'],
    });
    expect(rejected).toEqual([]);
    expect(answers).toEqual({
      satisfaction: 4,
      npsScore: 9,
      wouldPay: 'probably-yes',
      bestPart: 'The QR code just worked.',
      discoveryChannels: ['qr-sign', 'table-cards'],
    });
  });

  it('drops an unknown question id rather than storing it', () => {
    // The submission is client-built, so this is what stops a crafted request
    // writing arbitrary attributes onto the row.
    const { answers, rejected } = cleanAnswers({ isAdmin: 'true', bestPart: 'ok' });
    expect(answers).not.toHaveProperty('isAdmin');
    expect(rejected).toContain('isAdmin');
  });

  it('refuses a choice that was never offered', () => {
    const { answers, rejected } = cleanAnswers({ wouldPay: 'with-bitcoin' });
    expect(answers).not.toHaveProperty('wouldPay');
    expect(rejected).toContain('wouldPay');
  });

  it('refuses a score outside its scale', () => {
    expect(cleanAnswers({ npsScore: 11 }).rejected).toContain('npsScore');
    expect(cleanAnswers({ npsScore: -1 }).rejected).toContain('npsScore');
    expect(cleanAnswers({ satisfaction: 6 }).rejected).toContain('satisfaction');
    expect(cleanAnswers({ satisfaction: 2.5 }).rejected).toContain('satisfaction');
  });

  it('accepts a numeric string for a score, since a form field gives one', () => {
    expect(cleanAnswers({ npsScore: '8' }).answers.npsScore).toBe(8);
  });

  it('keeps zero, which is a real NPS answer', () => {
    // Falsy but meaningful: a detractor answering 0 must not be dropped.
    expect(cleanAnswers({ npsScore: 0 }).answers.npsScore).toBe(0);
  });

  it('refuses a multi-select that is not a list', () => {
    expect(cleanAnswers({ discoveryChannels: 'qr-sign' }).rejected).toContain('discoveryChannels');
  });

  it('refuses a multi-select containing anything unoffered', () => {
    expect(cleanAnswers({ discoveryChannels: ['qr-sign', 'telepathy'] }).rejected).toContain(
      'discoveryChannels',
    );
  });

  it('de-duplicates a multi-select', () => {
    expect(cleanAnswers({ discoveryChannels: ['qr-sign', 'qr-sign'] }).answers.discoveryChannels)
      .toEqual(['qr-sign']);
  });

  it('trims and caps long text', () => {
    const long = 'x'.repeat(MAX_TEXT_ANSWER_LENGTH + 500);
    const { answers } = cleanAnswers({ bestPart: `  ${long}  ` });
    expect((answers.bestPart as string).length).toBe(MAX_TEXT_ANSWER_LENGTH);
  });

  it('stores an empty answer as absent rather than as an empty string', () => {
    const { answers, rejected } = cleanAnswers({ bestPart: '   ', worstPart: null });
    expect(answers).not.toHaveProperty('bestPart');
    expect(answers).not.toHaveProperty('worstPart');
    // Not answering is not an error.
    expect(rejected).toEqual([]);
  });

  it('carries the Other free text and caps it shorter', () => {
    const { answers } = cleanAnswers({
      eventType: 'other',
      eventTypeOther: `  ${'y'.repeat(MAX_OTHER_TEXT_LENGTH + 50)}  `,
    });
    expect(answers.eventType).toBe('other');
    expect((answers.eventTypeOther as string).length).toBe(MAX_OTHER_TEXT_LENGTH);
  });

  it('ignores an Other box belonging to no question', () => {
    const { answers } = cleanAnswers({ nonsenseOther: 'hello' });
    expect(answers).toEqual({});
  });
});

describe('when the survey is due', () => {
  it('is three days after a stated event date', () => {
    const due = surveyDueAt({ date: '2026-06-01' });
    expect(due?.toISOString()).toBe(
      new Date(Date.parse('2026-06-01T00:00:00Z') + SURVEY_DAYS_AFTER_EVENT_DATE * DAY_MS).toISOString(),
    );
  });

  it('never lands before the event could have finished, anywhere on earth', () => {
    // An event dated D can still be running at D 23:59 in UTC-12, which is
    // D+1 11:59 UTC. Arriving mid-event costs the response, so the rule has to
    // clear that everywhere.
    const due = surveyDueAt({ date: '2026-06-01' })!;
    const latestPossibleFinish = Date.parse('2026-06-02T11:59:00Z');
    expect(due.getTime()).toBeGreaterThan(latestPossibleFinish);
  });

  it('falls back to two weeks after payment when no date was given', () => {
    const due = surveyDueAt({ date: null, paidAt: '2026-06-01T10:00:00Z' });
    expect(due?.toISOString()).toBe(
      new Date(Date.parse('2026-06-01T10:00:00Z') + SURVEY_DAYS_AFTER_ACQUISITION * DAY_MS).toISOString(),
    );
  });

  it('uses the created date for a comped event that was never paid for', () => {
    // The Founding 20 got SharePix free, so there is no payment to measure
    // from — and they are exactly who this survey is for.
    const due = surveyDueAt({ paidAt: null, createdAt: '2026-06-01T10:00:00Z' });
    expect(due?.toISOString()).toBe(
      new Date(Date.parse('2026-06-01T10:00:00Z') + SURVEY_DAYS_AFTER_ACQUISITION * DAY_MS).toISOString(),
    );
  });

  it('prefers the stated date over the fallback', () => {
    const due = surveyDueAt({ date: '2026-06-01', createdAt: '2026-01-01T00:00:00Z' });
    expect(due?.toISOString().startsWith('2026-06-04')).toBe(true);
  });

  it('ignores a malformed date and falls through', () => {
    const due = surveyDueAt({ date: 'next Tuesday', createdAt: '2026-06-01T00:00:00Z' });
    expect(due?.toISOString().startsWith('2026-06-15')).toBe(true);
  });

  it('returns null when there is nothing at all to measure from', () => {
    expect(surveyDueAt({})).toBeNull();
    expect(surveyDueAt({ date: '', paidAt: '', createdAt: '' })).toBeNull();
  });

  it('is not due before its moment and is due after', () => {
    const event = { date: '2026-06-01' };
    expect(surveyIsDue(event, new Date('2026-06-03T23:59:00Z'))).toBe(false);
    expect(surveyIsDue(event, new Date('2026-06-04T00:00:00Z'))).toBe(true);
    expect(surveyIsDue(event, new Date('2026-07-01T00:00:00Z'))).toBe(true);
  });

  it('is never due for an event it cannot date', () => {
    expect(surveyIsDue({}, new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('the single reminder', () => {
  const requestedAt = '2026-06-04T00:00:00Z';
  const afterFiveDays = new Date(Date.parse(requestedAt) + SURVEY_REMINDER_DAYS * DAY_MS);

  it('waits five days after the invitation', () => {
    expect(reminderIsDue({ requestedAt }, new Date(Date.parse(requestedAt) + 4 * DAY_MS))).toBe(false);
    expect(reminderIsDue({ requestedAt }, afterFiveDays)).toBe(true);
  });

  it('is never due once the survey is complete', () => {
    expect(
      reminderIsDue({ requestedAt, completedAt: '2026-06-05T00:00:00Z' }, afterFiveDays),
    ).toBe(false);
  });

  it('is never due a second time', () => {
    // One reminder, and only one — enforced here rather than trusted to the
    // caller remembering.
    expect(
      reminderIsDue(
        { requestedAt, reminderSentAt: '2026-06-09T00:00:00Z' },
        new Date('2026-08-01T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('is not due when the invitation has no timestamp', () => {
    expect(reminderIsDue({}, new Date('2030-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('research flags', () => {
  it('flags a low satisfaction score', () => {
    expect(researchFlags({ satisfaction: 3 })).toContain('low-satisfaction');
    expect(researchFlags({ satisfaction: 4 })).not.toContain('low-satisfaction');
  });

  it('flags a detractor or passive NPS', () => {
    expect(researchFlags({ npsScore: 6 })).toContain('low-nps');
    expect(researchFlags({ npsScore: 0 })).toContain('low-nps');
    expect(researchFlags({ npsScore: 7 })).not.toContain('low-nps');
  });

  it('flags an unwilling buyer', () => {
    expect(researchFlags({ wouldPay: 'probably-not' })).toContain('would-not-pay');
    expect(researchFlags({ wouldPay: 'definitely-not' })).toContain('would-not-pay');
    expect(researchFlags({ wouldPay: 'not-sure' })).not.toContain('would-not-pay');
  });

  it('flags a host who stopped to explain something', () => {
    expect(researchFlags({ worstPart: 'a'.repeat(80) })).toContain('substantial-answer');
    expect(researchFlags({ oneChange: 'a'.repeat(200) })).toContain('substantial-answer');
    expect(researchFlags({ worstPart: 'fine' })).not.toContain('substantial-answer');
  });

  it('does not flag praise written at length', () => {
    // bestPart is deliberately not a flagged field: a long compliment is not a
    // product-learning opportunity, and treating it as one would bury the ones
    // that are.
    expect(researchFlags({ bestPart: 'a'.repeat(400) })).toEqual([]);
  });

  it('says nothing about a happy response', () => {
    expect(researchFlags({ satisfaction: 5, npsScore: 10, wouldPay: 'definitely-yes' })).toEqual([]);
  });

  it('can raise several at once', () => {
    const flags = researchFlags({ satisfaction: 2, npsScore: 3, wouldPay: 'definitely-not' });
    expect(flags).toEqual(
      expect.arrayContaining(['low-satisfaction', 'low-nps', 'would-not-pay']),
    );
  });
});

describe('NPS', () => {
  it('buckets by the standard boundaries', () => {
    expect(npsBucket(10)).toBe('promoter');
    expect(npsBucket(9)).toBe('promoter');
    expect(npsBucket(8)).toBe('passive');
    expect(npsBucket(7)).toBe('passive');
    expect(npsBucket(6)).toBe('detractor');
    expect(npsBucket(0)).toBe('detractor');
  });

  it('has no bucket for a missing or impossible score', () => {
    expect(npsBucket(null)).toBeNull();
    expect(npsBucket(undefined)).toBeNull();
    expect(npsBucket(11)).toBeNull();
    expect(npsBucket(-1)).toBeNull();
    expect(npsBucket(7.5)).toBeNull();
  });

  it('is promoters minus detractors as a percentage', () => {
    // 2 promoters, 1 passive, 1 detractor → (2-1)/4 = 25%
    expect(netPromoterScore([10, 9, 8, 3])).toBe(25);
    expect(netPromoterScore([10, 10])).toBe(100);
    expect(netPromoterScore([0, 0])).toBe(-100);
  });

  it('is null rather than zero when nobody has answered', () => {
    // Zero is a real, neutral score. Reporting it for "no data" would read as
    // a measured result — the same distinction the monthly report keeps.
    expect(netPromoterScore([])).toBeNull();
    expect(netPromoterScore([null, undefined])).toBeNull();
  });

  it('ignores unanswered scores without counting them against the total', () => {
    expect(netPromoterScore([10, null, 10])).toBe(100);
  });
});

describe('the survey version', () => {
  it('is stamped and non-empty, so a response records what it was asked', () => {
    expect(SURVEY_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});
