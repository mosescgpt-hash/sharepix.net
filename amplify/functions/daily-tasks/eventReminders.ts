/**
 * The Lambda's copy of the reminder schedule.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so these
 * rules exist twice. Everything below the header is byte-identical to
 * lib/eventReminders.ts and __tests__/daily-tasks-copies.test.ts fails if it
 * drifts. If you change one, re-copy it over the other.
 *
 * This copy is the one that decides what actually gets sent.
 */

/** Days before expiry at which a reminder goes out. Most urgent last. */
export const REMINDER_DAYS_BEFORE = [60, 30, 7] as const;

export type ReminderDaysBefore = (typeof REMINDER_DAYS_BEFORE)[number];

/**
 * How long after a milestone a reminder may still be sent.
 *
 * Two days covers a missed run or two without ever sending something stale.
 * Beyond that the milestone is simply skipped: a host being told "60 days left"
 * when nine remain is worse than not being told, and the next milestone is
 * along shortly.
 */
export const REMINDER_CATCH_UP_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stable key for "this event, this milestone". One send, ever. */
export function reminderKey(eventId: string, daysBefore: number): string {
  return `${eventId}#gallery-expiry-${daysBefore}`;
}

export interface ReminderCandidate {
  daysBefore: ReminderDaysBefore;
  /** When the gallery actually closes. Stated in the message verbatim. */
  expiresAt: Date;
  /** Whole days from now until it closes, for the subject line. */
  daysRemaining: number;
}

/**
 * The reminder this event is due right now, or null.
 *
 * Returns at most ONE, always the most urgent that qualifies. An event whose
 * reminders were never sent — because this feature did not exist when it was
 * created — must not receive three emails in one morning, and of the three the
 * only one worth sending is the nearest.
 *
 * Returns null for an event that has already expired. There is nothing to warn
 * about once the gallery is gone, and a "your gallery closes soon" message
 * about something that closed last week is worse than silence.
 */
export function dueReminder(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
  alreadySent: readonly number[] = [],
): ReminderCandidate | null {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return null;
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return null;

  // Most urgent first: 7 before 30 before 60.
  const byUrgency = [...REMINDER_DAYS_BEFORE].sort((a, b) => a - b);
  for (const daysBefore of byUrgency) {
    if (alreadySent.includes(daysBefore)) continue;
    const milestone = expiresAt.getTime() - daysBefore * DAY_MS;
    const withinWindow =
      now.getTime() >= milestone &&
      now.getTime() < milestone + REMINDER_CATCH_UP_DAYS * DAY_MS;
    if (withinWindow) {
      return {
        daysBefore,
        expiresAt,
        daysRemaining: Math.max(0, Math.ceil(remainingMs / DAY_MS)),
      };
    }
  }
  return null;
}

/**
 * Milestones that have gone by without being sent and can never be sent now.
 *
 * Recorded rather than retried, so a job that comes back after a long outage
 * does not eventually fire a "60 days left" message at an event with a week to
 * live. Marking them spent is what makes `dueReminder` safe to call every day
 * forever.
 */
export function lapsedReminders(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
  alreadySent: readonly number[] = [],
): ReminderDaysBefore[] {
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return [];
  return REMINDER_DAYS_BEFORE.filter((daysBefore) => {
    if (alreadySent.includes(daysBefore)) return false;
    const milestone = expiresAt.getTime() - daysBefore * DAY_MS;
    return now.getTime() >= milestone + REMINDER_CATCH_UP_DAYS * DAY_MS;
  });
}

/** Human date for the message body: "14 March 2027". */
export function formatExpiryDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
