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
  eventId?: string | null;
  expiresAt?: string | null;
}

export type QuotaKind =
  | { kind: 'trial-day'; day: string }
  | { kind: 'corporate-seat'; hostSub: string; seat: number }
  | { kind: 'guestbook-guest'; eventId: string; who: string }
  | { kind: 'guestbook-address'; eventId: string; address: string }
  | { kind: 'unknown' };

/** Read a row id back into the limit it is. */
export function quotaKind(id: string): QuotaKind {
  const parts = (id ?? '').split('#');
  if (parts[0] === 'trial-day' && parts.length === 2 && parts[1]) {
    return { kind: 'trial-day', day: parts[1] };
  }
  if (parts[0] === 'corporate-seat' && parts.length === 3) {
    const seat = Number(parts[2]);
    if (parts[1] && Number.isInteger(seat) && seat >= 0) {
      return { kind: 'corporate-seat', hostSub: parts[1], seat };
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

/** The default daily allowance, for a day whose row predates `limit`. */
export const DEFAULT_FREE_EVENTS_PER_DAY = 25;

/** A Corporate seat still holding an event that is taking uploads. */
export function seatInUse(row: QuotaCounterRow, now: Date = new Date()): boolean {
  const ends = Date.parse(row.expiresAt ?? '');
  return Number.isFinite(ends) && ends > now.getTime();
}

/** A guest book counter that is currently refusing notes. */
export function guestBookLimitReached(row: QuotaCounterRow): boolean {
  const kind = quotaKind(row.id);
  const count = row.count ?? 0;
  if (kind.kind === 'guestbook-guest') return count >= MAX_ENTRIES_PER_GUEST;
  if (kind.kind === 'guestbook-address') return count >= MAX_ENTRIES_PER_ADDRESS;
  return false;
}
