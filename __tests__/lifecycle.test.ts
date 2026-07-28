import { eventLifecycle } from '../lib/lifecycle';

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
