import {
  ANALYTICS_EVENTS,
  CONTRIBUTOR_MILESTONES,
  FUNNEL_STAGES,
  NOT_MEASURED_FUNNEL,
  ONCE_PER_SCOPE,
  SERVER_TRUTH,
  UPLOAD_MILESTONES,
  analyticsId,
  conversion,
  firesOnce,
  isAnalyticsEvent,
  isServerTruth,
  milestonesCrossed,
  stageFor,
  stageTotals,
  type AnalyticsEventName,
} from '../lib/analytics';

describe('the event vocabulary', () => {
  it('has no duplicates', () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it('recognises its own names and nothing else', () => {
    expect(isAnalyticsEvent('event_created')).toBe(true);
    expect(isAnalyticsEvent('drop_table_events')).toBe(false);
    expect(isAnalyticsEvent('')).toBe(false);
  });

  it('places every event in exactly one stage', () => {
    for (const name of ANALYTICS_EVENTS) {
      const stages = FUNNEL_STAGES.filter((stage) => stage.events.includes(name));
      expect(stages).toHaveLength(1);
    }
  });

  it('numbers the stages one to eight with no gaps', () => {
    expect(FUNNEL_STAGES.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('where the funnel puts activation', () => {
  it('does not treat the sale as the product working', () => {
    // A sale is not a successful event: the customer has paid and received
    // nothing yet. Activation is somebody other than the host uploading.
    const purchase = stageFor('purchase_completed')!;
    const activation = stageFor('first_guest_upload')!;
    expect(activation.index).toBeGreaterThan(purchase.index);
    expect(activation.key).toBe('activate');
  });

  it('puts the successful event after activation, not at it', () => {
    expect(stageFor('successful_event')!.index).toBeGreaterThan(
      stageFor('first_guest_upload')!.index,
    );
  });
});

describe('what can be trusted', () => {
  it('marks server-written events as truth and browser-reported ones as claims', () => {
    expect(isServerTruth('event_created')).toBe(true);
    expect(isServerTruth('purchase_completed')).toBe(true);
    expect(isServerTruth('first_guest_upload')).toBe(true);
    // A page view is reported by a browser: blockable, reloadable, forgeable.
    expect(isServerTruth('pricing_view')).toBe(false);
    expect(isServerTruth('qr_downloaded')).toBe(false);
  });

  it('only claims truth for names that exist', () => {
    for (const name of SERVER_TRUTH) {
      expect(isAnalyticsEvent(name)).toBe(true);
    }
  });

  it('names what it still cannot answer', () => {
    expect(NOT_MEASURED_FUNNEL.length).toBeGreaterThan(0);
    // Each line gives a reason, not just a gap — the reason is the useful half.
    for (const line of NOT_MEASURED_FUNNEL) expect(line).toContain('—');
  });
});

describe('milestones fire once', () => {
  it('keys a once-per-scope event by name and scope alone', () => {
    // Two different unique values, same row id: the second write is a
    // conditional-put failure rather than a second row.
    expect(analyticsId('first_guest_upload', 'ev-1', 'a')).toBe('first_guest_upload#ev-1');
    expect(analyticsId('first_guest_upload', 'ev-1', 'b')).toBe('first_guest_upload#ev-1');
  });

  it('keys a repeatable event uniquely so every occurrence counts', () => {
    expect(analyticsId('pricing_view', 'anon', 'a')).not.toBe(
      analyticsId('pricing_view', 'anon', 'b'),
    );
  });

  it('separates the same milestone on different events', () => {
    expect(analyticsId('successful_event', 'ev-1', 'x')).not.toBe(
      analyticsId('successful_event', 'ev-2', 'x'),
    );
  });

  it('only names events that exist', () => {
    for (const name of ONCE_PER_SCOPE) expect(isAnalyticsEvent(name)).toBe(true);
  });

  it('treats a page view as repeatable', () => {
    expect(firesOnce('homepage_view')).toBe(false);
    expect(firesOnce('successful_event')).toBe(true);
  });
});

describe('counter milestones', () => {
  it('marks a threshold as it is crossed', () => {
    expect(milestonesCrossed(9, 10, UPLOAD_MILESTONES)).toEqual([10]);
    expect(milestonesCrossed(4, 5, CONTRIBUTOR_MILESTONES)).toEqual([5]);
  });

  it('marks every threshold a jump passes', () => {
    // A bulk upload can cross several at once, and each is a real milestone.
    expect(milestonesCrossed(8, 60, UPLOAD_MILESTONES)).toEqual([10, 25, 50]);
  });

  it('marks nothing when the counter did not move', () => {
    expect(milestonesCrossed(10, 10, UPLOAD_MILESTONES)).toEqual([]);
  });

  it('marks nothing when the counter went backwards', () => {
    // A deleted photo must not re-fire the milestone on the way back up.
    expect(milestonesCrossed(30, 20, UPLOAD_MILESTONES)).toEqual([]);
  });

  it('marks nothing for a threshold already passed', () => {
    expect(milestonesCrossed(30, 40, UPLOAD_MILESTONES)).toEqual([]);
  });
});

describe('rolling up by stage', () => {
  const wired: AnalyticsEventName[] = ['event_created', 'purchase_completed', 'first_guest_upload'];

  it('counts the events that are wired', () => {
    const totals = stageTotals(
      [
        { name: 'purchase_completed', count: 12 },
        { name: 'event_created', count: 9 },
      ],
      wired,
    );
    expect(totals.find((t) => t.stage.key === 'create')!.total).toBe(9);
    expect(totals.find((t) => t.stage.key === 'decide')!.total).toBe(12);
  });

  it('leaves a stage null when nothing in it is wired at all', () => {
    // Not zero. A stage rendered from nothing is worse than a stage left out:
    // one wrong figure makes every other figure on the page suspect.
    const totals = stageTotals([], wired);
    expect(totals.find((t) => t.stage.key === 'discover')!.total).toBeNull();
    expect(totals.find((t) => t.stage.key === 'believe')!.total).toBeNull();
  });

  it('shows a wired event with no rows as zero', () => {
    // Different from absent: something fires this and it has not happened.
    const totals = stageTotals([], wired);
    expect(totals.find((t) => t.stage.key === 'create')!.total).toBe(0);
  });

  it('carries whether each figure is server truth', () => {
    const totals = stageTotals([{ name: 'event_created', count: 3 }], wired);
    const create = totals.find((t) => t.stage.key === 'create')!;
    expect(create.events[0]).toEqual({ name: 'event_created', count: 3, serverTruth: true });
  });
});

describe('conversion between stages', () => {
  it('is a percentage', () => {
    expect(conversion(100, 25)).toBe(25);
    expect(conversion(8, 4)).toBe(50);
  });

  it('is null when the earlier stage is empty', () => {
    // Dividing by nothing is not a rate of zero, and "0%" for a stage nobody
    // has reached says something false about the product.
    expect(conversion(0, 0)).toBeNull();
    expect(conversion(null, 5)).toBeNull();
    expect(conversion(10, null)).toBeNull();
  });
});
