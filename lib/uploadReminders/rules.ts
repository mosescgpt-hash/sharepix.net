/**
 * Guest upload reminders: the rules for who is asked, when mail goes out, and
 * when the address is forgotten.
 *
 * After a guest's first upload, the page offers to email them a nudge to add
 * more. Reminder 1 is the morning after the event (10:00 in the event's time
 * zone); reminder 2 is three days before uploads close, and only when the
 * window is longer than a week. Opt-in rows are deleted 30 days after the
 * window closes.
 *
 * Pure, with no imports, because Amplify functions cannot import from lib/:
 * this file is copied byte-for-byte below the header into
 * amplify/functions/upload-reminders/rules.ts and
 * amplify/functions/send-upload-reminders/rules.ts, and
 * __tests__/upload-reminders.test.ts fails if a copy drifts. The browser's
 * copy only chooses wording; the function copies decide.
 */

/** Local hour both reminders go out at. */
export const REMINDER_HOUR = 10;
/** Reminder 2 goes out this many days before uploads close. */
export const SECOND_REMINDER_DAYS_BEFORE_CLOSE = 3;
/** Reminder 2 only exists when the upload window is longer than this. */
export const SECOND_REMINDER_MIN_WINDOW_DAYS = 7;
/**
 * How long after its due time a reminder may still go out. Covers a failed
 * hourly run or two; past this a "tomorrow" nudge would arrive days late, so it
 * is skipped instead.
 */
export const CATCH_UP_HOURS = 48;
/** Opt-in rows are deleted this long after the upload window closes. */
export const PURGE_AFTER_DAYS = 30;
/** Abuse ceiling, not a product limit: no real event has this many. */
export const MAX_OPT_INS_PER_EVENT = 3000;
/**
 * Used only when an event has reminders on but no time zone stored, which the
 * settings mutation prevents. Central time puts 10:00 between 08:00 Pacific
 * and 11:00 Eastern, the least-bad guess for a US audience.
 */
export const DEFAULT_TIME_ZONE = 'America/Chicago';
export const MAX_EMAIL_LENGTH = 254;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The event fields these rules read. */
export interface ReminderEvent {
  /** The host's event date, YYYY-MM-DD, or null. */
  date?: string | null;
  uploadWindowEndsAt?: string | null;
  timeZone?: string | null;
  uploadRemindersEnabled?: boolean | null;
  uploadsClosed?: boolean | null;
  paid?: boolean | null;
  takenDownAt?: string | null;
}

export interface ReminderOptInState {
  createdAt: string;
  firstSentAt?: string | null;
  secondSentAt?: string | null;
  unsubscribed?: boolean | null;
}

export type ReminderKind = 'first' | 'second';

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Milliseconds the zone is ahead of UTC at that instant. */
function zoneOffset(instant: number, timeZone: string): number {
  const p = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time happens in a zone. DST-safe. */
export function zonedTime(ymd: string, hour: number, timeZone: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, 0, 0);
  // Two passes: the first guess can land on the wrong side of a DST change.
  const first = wall - zoneOffset(wall, timeZone);
  return new Date(wall - zoneOffset(first, timeZone));
}

/** The calendar date an instant falls on in a zone, as YYYY-MM-DD. */
export function localDate(instant: number, timeZone: string): string {
  const p = zoneParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parse(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function zoneFor(event: ReminderEvent): string {
  return isValidTimeZone(event.timeZone) ? event.timeZone : DEFAULT_TIME_ZONE;
}

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

export interface ReminderSchedule {
  first: Date | null;
  second: Date | null;
  closesAt: Date | null;
}

/**
 * When each reminder is due for this event.
 *
 * `windowStart` measures the window for an event with no date: the moment the
 * guest opted in, since that is the time they actually have left.
 */
export function reminderSchedule(event: ReminderEvent, windowStart: number): ReminderSchedule {
  const zone = zoneFor(event);
  const closes = parse(event.uploadWindowEndsAt);
  const first = isDate(event.date) ? zonedTime(addDays(event.date, 1), REMINDER_HOUR, zone) : null;

  let second: Date | null = null;
  if (closes !== null) {
    const start = isDate(event.date) ? zonedTime(event.date, 0, zone).getTime() : windowStart;
    if (closes - start > SECOND_REMINDER_MIN_WINDOW_DAYS * DAY_MS) {
      const day = addDays(localDate(closes, zone), -SECOND_REMINDER_DAYS_BEFORE_CLOSE);
      const at = zonedTime(day, REMINDER_HOUR, zone);
      // Never two nudges on the same morning.
      if (!first || at.getTime() - first.getTime() >= DAY_MS) second = at;
    }
  }
  return { first, second, closesAt: closes === null ? null : new Date(closes) };
}

/** Whether the event is taking opt-ins and sending at all. */
export function remindersActive(event: ReminderEvent, now: number): boolean {
  if (event.uploadRemindersEnabled !== true) return false;
  if (event.paid === false || event.uploadsClosed === true || event.takenDownAt) return false;
  const closes = parse(event.uploadWindowEndsAt);
  return closes === null || now < closes;
}

/**
 * What a guest opting in now would get: the "tomorrow" reminder, the
 * before-close one, or nothing (in which case the page doesn't ask).
 */
export function reminderOffer(
  event: ReminderEvent,
  now: number,
): { kind: ReminderKind; at: Date; closesAt: Date | null } | null {
  if (!remindersActive(event, now)) return null;
  const s = reminderSchedule(event, now);
  if (s.first && now < s.first.getTime()) return { kind: 'first', at: s.first, closesAt: s.closesAt };
  if (s.second && now < s.second.getTime()) return { kind: 'second', at: s.second, closesAt: s.closesAt };
  return null;
}

/** The reminder this opt-in is due right now, or null. Reminder 2 wins a tie. */
export function dueReminder(
  event: ReminderEvent,
  optIn: ReminderOptInState,
  now: number,
): ReminderKind | null {
  if (optIn.unsubscribed === true || !remindersActive(event, now)) return null;
  const created = parse(optIn.createdAt);
  if (created === null) return null;
  const s = reminderSchedule(event, created);
  const catchUp = CATCH_UP_HOURS * HOUR_MS;
  const inWindow = (at: Date | null) => !!at && now >= at.getTime() && now < at.getTime() + catchUp;

  if (!optIn.secondSentAt && inWindow(s.second)) return 'second';
  // Only guests who asked before the morning after get the "tomorrow" one;
  // someone who opts in at noon that day is waiting for reminder 2 instead.
  if (!optIn.firstSentAt && inWindow(s.first) && created < s.first!.getTime()) return 'first';
  return null;
}

/** True once the row should be deleted: 30 days after uploads close. */
export function purgeDue(uploadWindowEndsAt: string | null | undefined, now: number): boolean {
  const closes = parse(uploadWindowEndsAt);
  return closes !== null && now >= closes + PURGE_AFTER_DAYS * DAY_MS;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Deliberately plain: one @, a dotted domain with a letter TLD, no spaces,
 * nothing that could break a header. Not RFC 5322 in full, which allows
 * addresses no mailbox provider hands out.
 */
export function isValidEmail(email: string): boolean {
  if (!email || email.length > MAX_EMAIL_LENGTH) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at !== email.indexOf('@')) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || /\.\./.test(email)) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(l))) return false;
  return /^[a-z]{2,}$/i.test(labels[labels.length - 1]);
}
