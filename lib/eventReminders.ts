/**
 * When to warn a host that their gallery is about to close.
 *
 * From the retention brief: reminders at roughly 60, 30 and 7 days before
 * expiry. The value of the last one is obvious — it is the final chance to
 * download photos that are otherwise deleted — and the value of the first two
 * is that "I did not know" is the complaint this whole feature exists to
 * prevent.
 *
 * ## These are essential mail, not marketing
 *
 * The message is "the thing you paid us to keep is about to stop existing".
 * A host who has opted out of everything optional still gets these, because the
 * alternative is losing their wedding photos to a preference they set about
 * something else. See lib/emailPreferences.ts for where that line is drawn.
 *
 * ## Why a window rather than an exact day
 *
 * A reminder is due when *today* falls inside a short window after the
 * milestone, not exactly on it. A scheduled job that does not run — a failed
 * deploy, an AWS hiccup, a Lambda that timed out halfway through — would
 * otherwise silently skip a host's only warning. The window is deliberately
 * short, and every message states the real expiry date rather than a countdown,
 * so a reminder that arrives a day or two late is still exactly true.
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
