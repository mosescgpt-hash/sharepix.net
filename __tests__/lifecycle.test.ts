import { archiveWindowEnd, eventLifecycle } from '../lib/lifecycle';

// Standard: 30-day upload window, guests low-res 30 days after, host retention
// 90 days after. Window closes 2026-02-01.
const standard = { tier: 'standard', uploadWindowEndsAt: '2026-02-01T00:00:00.000Z' };

describe('event lifecycle', () => {
  it('is open with larger view before the window closes', () => {
    const lc = eventLifecycle(standard, new Date('2026-01-15T00:00:00Z'));
    expect(lc.uploadOpen).toBe(true);
    expect(lc.guestResolution).toBe('larger');
    expect(lc.hostAccess).toBe(true);
  });

  it('drops guests to small after the window, uploads closed', () => {
    const lc = eventLifecycle(standard, new Date('2026-02-15T00:00:00Z'));
    expect(lc.uploadOpen).toBe(false);
    expect(lc.guestResolution).toBe('small');
    expect(lc.hostAccess).toBe(true);
  });

  it('shows guests nothing after the low-res window but host still has access', () => {
    const lc = eventLifecycle(standard, new Date('2026-03-10T00:00:00Z'));
    expect(lc.guestResolution).toBe('none');
    expect(lc.hostAccess).toBe(true);
  });

  it('archives (no host access) after the retention period', () => {
    const lc = eventLifecycle(standard, new Date('2026-05-15T00:00:00Z'));
    expect(lc.hostAccess).toBe(false);
    expect(lc.archived).toBe(true);
  });

  it('gives Starter guests only 3 weeks of low-res viewing', () => {
    const starter = { tier: 'starter', uploadWindowEndsAt: '2026-02-01T00:00:00.000Z' };
    // 25 days after the window: past Starter's 21-day low-res window.
    expect(eventLifecycle(starter, new Date('2026-02-26T00:00:00Z')).guestResolution).toBe('none');
    // 10 days after: still low-res.
    expect(eventLifecycle(starter, new Date('2026-02-11T00:00:00Z')).guestResolution).toBe('small');
  });

  it('treats legacy events with no window as fully open', () => {
    const lc = eventLifecycle({ tier: 'standard' }, new Date('2026-02-15T00:00:00Z'));
    expect(lc.uploadOpen).toBe(true);
    expect(lc.guestResolution).toBe('larger');
    expect(lc.hostAccess).toBe(true);
  });

  it('honors a manual close during the open window', () => {
    const lc = eventLifecycle(
      { ...standard, uploadsClosed: true },
      new Date('2026-01-15T00:00:00Z'),
    );
    expect(lc.uploadOpen).toBe(false);
    expect(lc.guestResolution).toBe('larger');
  });
});

describe('archiving by hand', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('puts the event straight into the archive window', () => {
    // Archive is meant to take effect on the next render, not "soon".
    for (const tier of ['starter', 'standard', 'premium', 'corporate']) {
      const archived = { tier, uploadWindowEndsAt: archiveWindowEnd({ tier }, now) };
      const lc = eventLifecycle(archived, now);
      expect(lc.archived).toBe(true);
      expect(lc.hostAccess).toBe(false);
      expect(lc.guestResolution).toBe('none');
      expect(lc.uploadOpen).toBe(false);
    }
  });

  it('leaves the host essentially the whole recovery window', () => {
    // Landing the event deep in the archive would silently spend recovery days
    // the host is entitled to. It should sit just past the boundary.
    const archived = {
      tier: 'standard',
      uploadWindowEndsAt: archiveWindowEnd({ tier: 'standard' }, now),
    };
    const end = eventLifecycle(archived, now).archiveEndsAt!;
    const daysLeft = (end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysLeft).toBeGreaterThan(89.9);
    expect(daysLeft).toBeLessThanOrEqual(90);
  });

  it('respects each plan’s retention when computing the boundary', () => {
    // Premium retains for a year, Starter for three weeks — one constant would
    // archive a Premium event nine months early.
    const premium = archiveWindowEnd({ tier: 'premium' }, now);
    const starter = archiveWindowEnd({ tier: 'starter' }, now);
    expect(new Date(premium).getTime()).toBeLessThan(new Date(starter).getTime());
  });

  it('exposes when an archived event stops being recoverable', () => {
    const lc = eventLifecycle(standard, new Date('2026-05-15T00:00:00Z'));
    expect(lc.archiveEndsAt).toBeInstanceOf(Date);
    expect(lc.archiveEndsAt!.getTime()).toBeGreaterThan(lc.retentionEndsAt!.getTime());
  });

  it('has no archive deadline for an event with no window', () => {
    expect(eventLifecycle({ tier: 'standard' }).archiveEndsAt).toBeNull();
  });
});
