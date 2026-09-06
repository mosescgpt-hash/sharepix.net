import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REMINDER_CATCH_UP_DAYS,
  REMINDER_DAYS_BEFORE,
  dueReminder,
  formatExpiryDate,
  lapsedReminders,
  reminderKey,
} from '../lib/eventReminders';
import {
  DEFAULT_RETENTION_DAYS,
  RETENTION_DAYS_BY_TIER,
  buildExpiryMessage,
  galleryExpiresAt,
  isSafeAppUrl,
  sanitizeHeaderValue,
} from '../amplify/functions/daily-tasks/expiryMessage';
import { ALL_TIERS, CORPORATE_PLAN, UPLOAD_WINDOW_DAYS } from '../lib/pricing';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

const DAY = 24 * 60 * 60 * 1000;
const EXPIRY = new Date('2027-03-14T12:00:00.000Z');
const at = (daysBefore: number, offsetMs = 0) =>
  new Date(EXPIRY.getTime() - daysBefore * DAY + offsetMs);

describe('the two copies have not drifted', () => {
  it('keeps the Lambda copy of the reminder schedule byte-identical', () => {
    expect(bodyOf(read('amplify/functions/daily-tasks/eventReminders.ts'))).toBe(
      bodyOf(read('lib/eventReminders.ts')),
    );
  });

  it('keeps the Lambda copy of the preference rules byte-identical', () => {
    expect(bodyOf(read('amplify/functions/daily-tasks/emailPreferences.ts'))).toBe(
      bodyOf(read('lib/emailPreferences.ts')),
    );
  });
});

describe('when a reminder is due', () => {
  it('sends at 60, 30 and 7 days out, as the retention brief specifies', () => {
    expect([...REMINDER_DAYS_BEFORE]).toEqual([60, 30, 7]);
    for (const days of REMINDER_DAYS_BEFORE) {
      expect(dueReminder(EXPIRY, at(days))?.daysBefore).toBe(days);
    }
  });

  it('sends nothing on an ordinary day between milestones', () => {
    expect(dueReminder(EXPIRY, at(45))).toBeNull();
    expect(dueReminder(EXPIRY, at(20))).toBeNull();
  });

  it('still sends a day or two late, so a missed run is not a missed warning', () => {
    // A failed deploy or a timed-out Lambda must not cost a host their only
    // warning. Every message states the real date, so slight lateness is
    // still exactly true.
    expect(dueReminder(EXPIRY, at(30, 1.5 * DAY))?.daysBefore).toBe(30);
  });

  it('gives up once the catch-up window has passed', () => {
    // "60 days left" delivered to an event with nine is worse than silence.
    expect(dueReminder(EXPIRY, at(60, (REMINDER_CATCH_UP_DAYS + 0.5) * DAY))).toBeNull();
  });

  it('never sends more than one reminder at a time, and picks the most urgent', () => {
    // An event created before this feature existed has every milestone
    // outstanding. It must not get three emails in one morning.
    const due = dueReminder(EXPIRY, at(7));
    expect(due?.daysBefore).toBe(7);
  });

  it('skips milestones already dealt with', () => {
    expect(dueReminder(EXPIRY, at(30), [30])).toBeNull();
    expect(dueReminder(EXPIRY, at(7), [60, 30])?.daysBefore).toBe(7);
  });

  it('says nothing about a gallery that has already closed', () => {
    // There is nothing left to warn about, and "closes soon" about something
    // that closed last week is worse than silence.
    expect(dueReminder(EXPIRY, new Date(EXPIRY.getTime() + DAY))).toBeNull();
    expect(dueReminder(EXPIRY, EXPIRY)).toBeNull();
  });

  it('says nothing about an event with no expiry at all', () => {
    // Events created before the lifecycle model have no upload window and
    // never expire.
    expect(dueReminder(null, at(7))).toBeNull();
    expect(dueReminder(undefined, at(7))).toBeNull();
    expect(dueReminder(new Date('nonsense'), at(7))).toBeNull();
  });

  it('reports the real days remaining, not the milestone', () => {
    const due = dueReminder(EXPIRY, at(30, 1.5 * DAY));
    expect(due?.daysRemaining).toBe(29);
  });
});

describe('milestones that lapsed', () => {
  it('marks the ones that went by unsent, so they never fire late', () => {
    // A job returning after an outage must record these rather than send them.
    // Six days out: 60 and 30 are long gone, 7 passed one day ago and is still
    // inside its catch-up window, so it is not lapsed yet.
    expect(lapsedReminders(EXPIRY, at(6))).toEqual([60, 30]);
    // Four days out, 7 has fallen out of its window too.
    expect(lapsedReminders(EXPIRY, at(4))).toEqual([60, 30, 7]);
  });

  it('does not mark one that is still inside its window', () => {
    expect(lapsedReminders(EXPIRY, at(30))).toEqual([60]);
  });

  it('does not re-mark what is already recorded', () => {
    expect(lapsedReminders(EXPIRY, at(6), [60, 30])).toEqual([]);
    expect(lapsedReminders(EXPIRY, at(4), [60, 30, 7])).toEqual([]);
  });
});

describe('the notification key', () => {
  it('is unique per event and milestone', () => {
    expect(reminderKey('evt-1', 30)).toBe('evt-1#gallery-expiry-30');
    expect(reminderKey('evt-1', 30)).not.toBe(reminderKey('evt-1', 7));
    expect(reminderKey('evt-1', 30)).not.toBe(reminderKey('evt-2', 30));
  });
});

describe('when a gallery actually closes', () => {
  it('is the upload window plus the plan retention, matching eventLifecycle', () => {
    const windowEnd = '2026-06-01T12:00:00.000Z';
    const closes = galleryExpiresAt(windowEnd, 'plus');
    expect(closes?.toISOString()).toBe('2027-06-01T12:00:00.000Z');
  });

  it('gives the free trial its shorter gallery', () => {
    const closes = galleryExpiresAt('2026-06-01T12:00:00.000Z', 'free');
    expect(closes?.toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });

  it('agrees with lib/pricing.ts about every tier', () => {
    // The Lambda cannot import lib/, so this map is hand-copied. A tier whose
    // retention moved in one file and not the other would warn hosts about the
    // wrong date, and nothing else would notice.
    for (const tier of ALL_TIERS) {
      expect(RETENTION_DAYS_BY_TIER[tier.id]).toBe(tier.retentionDays);
    }
    expect(RETENTION_DAYS_BY_TIER.corporate).toBe(CORPORATE_PLAN.retentionDays);
  });

  it('falls back the same way eventLifecycle does for an unknown tier', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
    expect(galleryExpiresAt('2026-06-01T12:00:00.000Z', 'mystery')?.toISOString()).toBe(
      '2026-08-30T12:00:00.000Z',
    );
  });

  it('is null when there is no window to measure from', () => {
    expect(galleryExpiresAt(null, 'plus')).toBeNull();
    expect(galleryExpiresAt('not a date', 'plus')).toBeNull();
  });

  it('is derived from the window, so an extension moves it', () => {
    // An upload-window extension moves uploadWindowEndsAt and does not touch
    // accessExpiresAt. Reading the stored field would warn about a date that
    // had already moved.
    const before = galleryExpiresAt('2026-06-01T12:00:00.000Z', 'plus')!;
    const after = galleryExpiresAt('2026-07-01T12:00:00.000Z', 'plus')!;
    expect(after.getTime() - before.getTime()).toBe(30 * DAY);
    // And a brand-new event's expiry matches window + gallery from creation.
    expect(UPLOAD_WINDOW_DAYS).toBe(60);
  });
});

describe('the message', () => {
  const base = {
    eventName: 'Sam & Riley',
    expiresOn: '14 March 2027',
    daysRemaining: 30,
    galleryUrl: 'https://www.sharepix.net/event/abc/admin',
    canExtend: true,
  };

  it('states the real date in the body, not just a countdown', () => {
    const message = buildExpiryMessage(base);
    expect(message.text).toContain('14 March 2027');
    expect(message.html).toContain('14 March 2027');
  });

  it('gets more urgent at seven days', () => {
    expect(buildExpiryMessage({ ...base, daysRemaining: 7 }).subject).toMatch(/last chance/i);
    expect(buildExpiryMessage(base).subject).not.toMatch(/last chance/i);
  });

  it('does not offer a free event something it cannot buy', () => {
    const free = buildExpiryMessage({ ...base, canExtend: false });
    expect(free.text).toMatch(/cannot be extended/i);
  });

  it('sells nothing', () => {
    // This message tells someone their photos are about to stop existing. A
    // host who reads it and downloads is the successful outcome, even though it
    // earns nothing.
    const message = buildExpiryMessage(base);
    expect(message.text).not.toMatch(/upgrade|buy now|offer|discount/i);
  });

  it('escapes an event name rather than letting it into the HTML', () => {
    const message = buildExpiryMessage({ ...base, eventName: '<script>alert(1)</script>' });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });

  it('drops a link that is not one of ours', () => {
    // Only the app's own https URLs may appear, so a crafted value can never
    // turn a SharePix email into a phishing vector.
    for (const url of [
      'https://evil.example.com/event/abc',
      'javascript:alert(1)',
      'http://www.sharepix.net/event/abc',
    ]) {
      const message = buildExpiryMessage({ ...base, galleryUrl: url });
      expect(message.html).not.toContain(url);
      expect(message.text).not.toContain(url);
    }
    expect(isSafeAppUrl('https://www.sharepix.net/event/abc/admin')).toBe(true);
    expect(isSafeAppUrl('https://sharepix.net/event/abc/admin')).toBe(true);
    // A lookalike host must not pass just because our domain appears in it.
    expect(isSafeAppUrl('https://sharepix.net.evil.com/event/abc')).toBe(false);
    expect(isSafeAppUrl('https://notsharepix.net/event/abc')).toBe(false);
  });

  it('still says what to do when the link had to be dropped', () => {
    const message = buildExpiryMessage({ ...base, galleryUrl: 'javascript:alert(1)' });
    expect(message.text).toMatch(/sign in/i);
  });
});

describe('header safety', () => {
  it('keeps CR and LF out of a value that reaches a header', () => {
    // A newline in an event name would let it inject an extra header — a
    // forged From, an extra Bcc.
    expect(sanitizeHeaderValue('Wedding\r\nBcc: someone@example.com')).toBe(
      'Wedding Bcc: someone@example.com',
    );
    expect(sanitizeHeaderValue('a bcd')).toBe('a b c d');
  });

  it('bounds the length', () => {
    expect(sanitizeHeaderValue('x'.repeat(500))).toHaveLength(120);
  });
});

describe('formatting a date for a person', () => {
  it('writes it out rather than using digits that mean different things', () => {
    // 03/14 and 14/03 are the same day to different readers.
    expect(formatExpiryDate(EXPIRY)).toBe('14 March 2027');
  });
});
