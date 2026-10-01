/**
 * What a QuotaCounter row means, for the admin dashboard.
 *
 * The row id names the limit (see the QuotaCounter model in
 * amplify/data/resource.ts), so reading one is parsing its id. Kept pure and
 * apart from the page so the parsing is tested rather than eyeballed — an
 * admin pressing "Clear" on the wrong kind of row lifts the wrong limit.
 */
import { MAX_ENTRIES_PER_ADDRESS, MAX_ENTRIES_PER_GUEST } from './guestBook';

export interface QuotaCounterRow {
  id: string;
  count?: number | null;
  limit?: number | null;
  /** Requests the limit turned away. Daily free-event rows only. */
  refused?: number | null;
  eventId?: string | null;
  expiresAt?: string | null;
}

export type QuotaKind =
  | { kind: 'trial-day'; day: string }
  | { kind: 'corporate-month'; hostSub: string; month: string }
  | { kind: 'guestbook-guest'; eventId: string; who: string }
  | { kind: 'guestbook-address'; eventId: string; address: string }
  | { kind: 'unknown' };

/** Read a row id back into the limit it is. */
export function quotaKind(id: string): QuotaKind {
  const parts = (id ?? '').split('#');
  if (parts[0] === 'trial-day' && parts.length === 2 && parts[1]) {
    return { kind: 'trial-day', day: parts[1] };
  }
  if (parts[0] === 'corporate-month' && parts.length === 3) {
    if (parts[1] && /^\d{4}-\d{2}$/.test(parts[2])) {
      return { kind: 'corporate-month', hostSub: parts[1], month: parts[2] };
    }
  }
  if (parts[0] === 'guestbook' && parts.length >= 4 && parts[1]) {
    // An IPv6 address or an identity id cannot contain '#', but join the
    // remainder anyway so a surprising one is shown whole rather than cut.
    const rest = parts.slice(3).join('#');
    if (parts[2] === 'guest' && rest) return { kind: 'guestbook-guest', eventId: parts[1], who: rest };
    if (parts[2] === 'ip' && rest) return { kind: 'guestbook-address', eventId: parts[1], address: rest };
  }
  return { kind: 'unknown' };
}

/** The id of today's free-event counter, in UTC like create-event's. */
export function trialDayId(now: Date = new Date()): string {
  return `trial-day#${now.toISOString().slice(0, 10)}`;
}

/**
 * The daily free-event limit when no admin setting has been saved. Mirrors
 * DEFAULT_FREE_EVENTS_PER_DAY in create-event; a test pins the two together.
 */
export const DEFAULT_FREE_EVENTS_PER_DAY = 25;

/** The highest daily limit the setting accepts. Mirrors create-event. */
export const MAX_FREE_EVENTS_PER_DAY = 1000;

/** The AppSetting row create-event reads the limit from. */
export const FREE_EVENTS_SETTING_KEY = 'free-events-per-day';

/**
 * A daily limit as typed by an admin: a whole number from 0 (free events
 * paused) to MAX_FREE_EVENTS_PER_DAY, or null. Same rule create-event applies
 * when it reads the setting back, so the form cannot save a value the server
 * would silently ignore.
 */
export function parseDailyLimit(raw: string | null | undefined): number | null {
  const text = (raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value <= MAX_FREE_EVENTS_PER_DAY ? value : null;
}

/** One day of the free-event chart. */
export interface FreeEventDay {
  /** YYYY-MM-DD, UTC. */
  day: string;
  given: number;
  refused: number;
  /** The limit that day ran under, or null when nothing was recorded. */
  limit: number | null;
}

/**
 * The last `days` UTC days of free events, oldest first, with a zero for every
 * day nothing happened. A quiet day is a real data point — leaving it out
 * would make a gap look like a trend.
 */
export function freeEventSeries(
  rows: QuotaCounterRow[],
  days = 30,
  now: Date = new Date(),
): FreeEventDay[] {
  const byDay = new Map<string, QuotaCounterRow>();
  for (const row of rows) {
    const kind = quotaKind(row.id);
    if (kind.kind === 'trial-day') byDay.set(kind.day, row);
  }
  const series: FreeEventDay[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(today - i * 86_400_000).toISOString().slice(0, 10);
    const row = byDay.get(day);
    series.push({
      day,
      given: Math.max(0, row?.count ?? 0),
      refused: Math.max(0, row?.refused ?? 0),
      limit: row?.limit ?? null,
    });
  }
  return series;
}

export interface FreeEventAdvice {
  tone: 'info' | 'warn';
  message: string;
}

/**
 * Whether the limit looks too low, too high, or about right, in one sentence.
 *
 * Looks at the last seven days for "too low" because that is what a change
 * would act on, and at the whole window for headroom. It never says "raise
 * it" without the caveat: a sudden run of refusals is also what a script
 * farming free events looks like, and the free event claims list is where
 * that shows.
 */
export function freeEventAdvice(series: FreeEventDay[], currentLimit: number): FreeEventAdvice {
  if (currentLimit === 0) {
    return { tone: 'warn', message: 'Free events are paused. Nobody can start one until you set a limit above 0.' };
  }
  const week = series.slice(-7);
  const fullDays = week.filter(
    (d) => d.refused > 0 || (d.limit !== null && d.limit > 0 && d.given >= d.limit),
  ).length;
  const turnedAway = week.reduce((sum, d) => sum + d.refused, 0);
  if (fullDays > 0) {
    return {
      tone: 'warn',
      message: `The limit was reached on ${fullDays} of the last 7 days and turned away ${turnedAway} ${turnedAway === 1 ? 'request' : 'requests'}. If the free event claims look like real hosts, raise it; if they look like one person with many email addresses, leave it.`,
    };
  }
  const peak = Math.max(0, ...series.map((d) => d.given));
  if (peak >= currentLimit * 0.8) {
    return {
      tone: 'info',
      message: `The busiest day in the last ${series.length} used ${peak} of ${currentLimit}. Close to the limit, but nobody has been turned away yet.`,
    };
  }
  return {
    tone: 'info',
    message: `The busiest day in the last ${series.length} used ${peak} of ${currentLimit}. Plenty of room; no change needed.`,
  };
}

/**
 * A Corporate subscriber's counter for the current UTC month, with at least
 * one included event used. Last month's rows are history: the allowance has
 * already reset past them, so they are not something to act on.
 */
export function corporateMonthInUse(row: QuotaCounterRow, now: Date = new Date()): boolean {
  const kind = quotaKind(row.id);
  return (
    kind.kind === 'corporate-month' &&
    kind.month === now.toISOString().slice(0, 7) &&
    (row.count ?? 0) > 0
  );
}

/** A guest book counter that is currently refusing notes. */
export function guestBookLimitReached(row: QuotaCounterRow): boolean {
  const kind = quotaKind(row.id);
  const count = row.count ?? 0;
  if (kind.kind === 'guestbook-guest') return count >= MAX_ENTRIES_PER_GUEST;
  if (kind.kind === 'guestbook-address') return count >= MAX_ENTRIES_PER_ADDRESS;
  return false;
}
