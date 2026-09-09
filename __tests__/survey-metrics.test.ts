import {
  NOT_MEASURED_METRICS,
  buildMetricsSnapshot,
  readMetricsSnapshot,
} from '../lib/surveyMetrics';

describe('the event metrics snapshot', () => {
  const event = {
    id: 'ev-1',
    name: 'Sam and Ada',
    tier: 'plus',
    date: '2026-06-01',
    eventType: 'wedding',
    internalCohort: 'FOUNDING_20',
    createdAt: '2026-05-01T00:00:00Z',
    paidAt: '2026-05-01T00:05:00Z',
    paid: true,
    photoCount: 412,
    videoCount: 12,
    contributorCount: 31,
    guestUploadCount: 388,
    guestBookCount: 22,
    uploadWindowCount: 1,
  };

  it('carries what the event row already knows', () => {
    const snapshot = buildMetricsSnapshot(event, new Date('2026-06-10T00:00:00Z'));
    expect(snapshot).toMatchObject({
      eventId: 'ev-1',
      eventName: 'Sam and Ada',
      tier: 'plus',
      eventDate: '2026-06-01',
      eventType: 'wedding',
      internalCohort: 'FOUNDING_20',
      contributorCount: 31,
      guestUploadCount: 388,
      guestBookCount: 22,
      capturedAt: '2026-06-10T00:00:00.000Z',
    });
  });

  it('separates stills from videos, because the row counts both together', () => {
    // Event.photoCount counts every media item including videos.
    const snapshot = buildMetricsSnapshot(event);
    expect(snapshot.totalMediaCount).toBe(412);
    expect(snapshot.videoCount).toBe(12);
    expect(snapshot.photoCount).toBe(400);
  });

  it('never reports a negative still count', () => {
    // The two counters are maintained by different paths, so a stale total
    // could in principle sit below a corrected video count.
    const snapshot = buildMetricsSnapshot({ photoCount: 3, videoCount: 10 });
    expect(snapshot.photoCount).toBe(0);
  });

  it('reads missing counters as zero', () => {
    const snapshot = buildMetricsSnapshot({ id: 'ev-2' });
    expect(snapshot.photoCount).toBe(0);
    expect(snapshot.contributorCount).toBe(0);
    expect(snapshot.guestBookCount).toBe(0);
  });

  it('ignores a negative counter rather than passing it through', () => {
    expect(buildMetricsSnapshot({ contributorCount: -5 }).contributorCount).toBe(0);
  });

  it('treats a missing paid flag as active, like the rest of the codebase', () => {
    expect(buildMetricsSnapshot({ id: 'ev-3' }).paid).toBe(true);
    expect(buildMetricsSnapshot({ id: 'ev-3', paid: false }).paid).toBe(false);
  });

  it('carries no storage figure at all', () => {
    // photoBytes and videoBytes exist as fields and currently read zero,
    // because byte accounting is not running. Copying that in would record
    // "this event used no storage", which is false.
    const snapshot = buildMetricsSnapshot(event) as unknown as Record<string, unknown>;
    expect(snapshot).not.toHaveProperty('photoBytes');
    expect(snapshot).not.toHaveProperty('videoBytes');
    expect(snapshot).not.toHaveProperty('storageBytes');
  });

  it('names its own gaps, so a stored response explains itself', () => {
    const snapshot = buildMetricsSnapshot(event);
    expect(snapshot.notMeasured).toBe(NOT_MEASURED_METRICS);
    expect(NOT_MEASURED_METRICS.join(' ')).toMatch(/storage/i);
    expect(NOT_MEASURED_METRICS.join(' ')).toMatch(/QR scans/i);
  });

  it('gives every unmeasured line a reason, not just a name', () => {
    // "Storage used" alone tells a reader nothing about whether to trust the
    // rest; the reason is the useful half.
    for (const line of NOT_MEASURED_METRICS) {
      expect(line).toContain('—');
    }
  });
});

describe('reading a snapshot back', () => {
  it('round-trips through JSON', () => {
    const snapshot = buildMetricsSnapshot({ id: 'ev-1', photoCount: 5 });
    expect(readMetricsSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('is null for anything missing or malformed', () => {
    expect(readMetricsSnapshot(null)).toBeNull();
    expect(readMetricsSnapshot(undefined)).toBeNull();
    expect(readMetricsSnapshot('')).toBeNull();
    expect(readMetricsSnapshot('{not json')).toBeNull();
    expect(readMetricsSnapshot('"a string"')).toBeNull();
    expect(readMetricsSnapshot('null')).toBeNull();
  });
});
