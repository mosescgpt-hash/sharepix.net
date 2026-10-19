/**
 * When a booth event's full-resolution originals are removed (decision: 30
 * days after the event), and when the reminder goes out. Pure; identical in
 * booth-deliveries and booth-gallery (a test checks).
 */

export const RETENTION_DAYS = 30;
export const REMINDER_DAYS_BEFORE = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The moment originals are removed: 30 days after the end of the event's day
 * (UTC), or after it was created when no date was set. Null when neither can
 * be read — nothing is removed on a date nobody can name.
 */
export function originalsRemovedAt(event: { date?: string | null; createdAt?: string | null }): string | null {
  let base: number | null = null;
  if (event.date && /^\d{4}-\d{2}-\d{2}$/.test(event.date)) {
    base = Date.parse(`${event.date}T23:59:59Z`);
  } else if (event.createdAt) {
    base = Date.parse(event.createdAt);
  }
  if (base === null || !Number.isFinite(base)) return null;
  return new Date(base + RETENTION_DAYS * DAY_MS).toISOString();
}

export function reminderAt(removedAt: string): string {
  return new Date(Date.parse(removedAt) - REMINDER_DAYS_BEFORE * DAY_MS).toISOString();
}
