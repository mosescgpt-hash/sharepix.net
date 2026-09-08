/**
 * The monthly report function's copy of the report arithmetic.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so this
 * exists more than once. Everything below the header is byte-identical to
 * lib/monthlyReport.ts and __tests__/monthly-report.test.ts fails if it drifts.
 */

import { countBySource, type EventSource } from './attribution';
import { isSuccessfulEvent } from './successfulEvent';

/** What this report cannot tell you, and why. Printed in every email. */
export const NOT_MEASURED: readonly string[] = [
  // Cloudflare Web Analytics now counts page views, so visitors and pricing
  // views are measured — but it is a page-view counter, not an event tracker,
  // so nothing joins a pricing view to a checkout. The line shrank rather than
  // disappearing, which is the honest shape of what changed.
  'Checkout starts, and the pricing-to-purchase funnel — Cloudflare Web Analytics counts page views, not events',
  'Chargebacks — no dispute data comes back from Stripe yet',
  'Acquisition cost per channel — no ad spend is tracked',
  'Experiments and visitor intent — not built',
  'Referrals and credit — not built',
  'Support volume — no ticketing system',
];

export interface ReportEvent {
  createdAt?: string | null;
  tier?: string | null;
  source?: string | null;
  paid?: boolean | null;
  contributorCount?: number | null;
  guestUploadCount?: number | null;
}

export interface ReportIncentive {
  status?: string | null;
  amountUsd?: number | null;
  completedAt?: string | null;
}

/** A ledger row, for the refunds line. See lib/refunds.ts. */
export interface ReportRefund {
  status?: string | null;
  amountCents?: number | null;
  reason?: string | null;
  createdAt?: string | null;
}

/** Inclusive start, exclusive end — the half-open range everything else uses. */
export interface MonthRange {
  start: Date;
  end: Date;
  /** "September 2026", for the subject line and headings. */
  label: string;
}

/**
 * The calendar month before the one `now` falls in, and the one before that.
 *
 * The report covers a COMPLETED month. Running on the 1st and reporting the
 * month just ended means every figure is final — a report covering a month
 * still in progress invites comparing eleven days against thirty.
 */
export function reportMonths(now: Date = new Date()): { current: MonthRange; previous: MonthRange } {
  const startOfThisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthBefore = (offset: number): MonthRange => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1));
    return { start, end, label: monthLabel(start) };
  };
  void startOfThisMonth;
  return { current: monthBefore(1), previous: monthBefore(2) };
}

export function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function inRange(value: string | null | undefined, range: MonthRange): boolean {
  if (!value) return false;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return false;
  return at >= range.start.getTime() && at < range.end.getTime();
}

export interface MonthFigures {
  eventsCreated: number;
  paidEvents: number;
  freeEvents: number;
  successfulEvents: number;
  /** Percentage to one decimal, or null when there were no events at all. */
  successRate: number | null;
  guestUploads: number;
  contributors: number;
  /** Events whose host had used SharePix as somebody's guest first. */
  fromGuestUpload: number;
  bySource: Record<EventSource, number>;
  surveysCompleted: number;
  rewardsOwedUsd: number;
  /** Committed back to customers for events created in this month, in cents. */
  refundedCents: number;
  /** Claims still waiting on a decision, right now. */
  refundsAwaitingDecision: number;
}

export function figuresFor(
  events: readonly ReportEvent[],
  incentives: readonly ReportIncentive[],
  range: MonthRange,
  refunds: readonly ReportRefund[] = [],
): MonthFigures {
  const inMonth = events.filter((event) => inRange(event.createdAt, range));
  const successful = inMonth.filter((event) => isSuccessfulEvent(event));
  const bySource = countBySource(inMonth);
  return {
    eventsCreated: inMonth.length,
    paidEvents: inMonth.filter((event) => event.tier !== 'free').length,
    freeEvents: inMonth.filter((event) => event.tier === 'free').length,
    successfulEvents: successful.length,
    successRate:
      inMonth.length === 0
        ? null
        : Math.round((successful.length / inMonth.length) * 1000) / 10,
    guestUploads: inMonth.reduce((sum, e) => sum + (e.guestUploadCount ?? 0), 0),
    contributors: inMonth.reduce((sum, e) => sum + (e.contributorCount ?? 0), 0),
    fromGuestUpload: bySource.guest_upload,
    bySource,
    surveysCompleted: incentives.filter((i) => inRange(i.completedAt, range)).length,
    // Owed right now rather than owed in that month: an unpaid obligation is a
    // present fact, and the point of putting it in a monthly email is that
    // somebody notices it is still there.
    rewardsOwedUsd: incentives
      .filter((i) => i.status === 'AWAITING_MANUAL_FULFILLMENT')
      .reduce((sum, i) => sum + (i.amountUsd ?? 0), 0),
    // Refunds are dated by when they were claimed, so a claim filed in
    // September counts against September even if it is paid in October. The
    // alternative dates money to the day an admin happened to press a button.
    refundedCents: refunds
      .filter(
        (r) =>
          inRange(r.createdAt, range) &&
          (r.status === 'APPROVED' || r.status === 'RECORDED'),
      )
      .reduce((sum, r) => sum + Math.max(0, r.amountCents ?? 0), 0),
    // Outstanding now, not within the month — the point of putting it in a
    // monthly email is that somebody notices a claim nobody has answered.
    refundsAwaitingDecision: refunds.filter((r) => r.status === 'REQUESTED').length,
  };
}

/**
 * How a figure moved, as text.
 *
 * Returns '' when the previous month was zero. A change from nothing is not a
 * percentage, and "+100%" against a base of zero reads as growth when it means
 * "one thing happened".
 */
export function delta(current: number, previous: number): string {
  if (previous === 0) return '';
  const change = Math.round(((current - previous) / previous) * 1000) / 10;
  if (change === 0) return 'no change';
  return `${change > 0 ? '+' : ''}${change}%`;
}

/** One line of the report: a label, a number, and how it moved. */
export interface ReportLine {
  label: string;
  value: string;
  change: string;
}

export function reportLines(current: MonthFigures, previous: MonthFigures): ReportLine[] {
  const line = (label: string, value: string, now: number, before: number): ReportLine => ({
    label,
    value,
    change: delta(now, before),
  });
  return [
    line('Events created', String(current.eventsCreated), current.eventsCreated, previous.eventsCreated),
    line('Paid', String(current.paidEvents), current.paidEvents, previous.paidEvents),
    line('Free trials', String(current.freeEvents), current.freeEvents, previous.freeEvents),
    line(
      'Successful events',
      current.successRate === null
        ? String(current.successfulEvents)
        : `${current.successfulEvents} (${current.successRate}%)`,
      current.successfulEvents,
      previous.successfulEvents,
    ),
    line('Guest uploads', String(current.guestUploads), current.guestUploads, previous.guestUploads),
    line('Contributors', String(current.contributors), current.contributors, previous.contributors),
    line(
      'Hosts who were guests first',
      String(current.fromGuestUpload),
      current.fromGuestUpload,
      previous.fromGuestUpload,
    ),
    line(
      'Surveys completed',
      String(current.surveysCompleted),
      current.surveysCompleted,
      previous.surveysCompleted,
    ),
    line(
      'Refunded',
      `$${(current.refundedCents / 100).toFixed(2)}`,
      current.refundedCents,
      previous.refundedCents,
    ),
  ];
}

/**
 * The one line worth putting at the top, or ''.
 *
 * Deliberately conservative: it only speaks when a figure is both meaningfully
 * different and based on enough events to mean anything. A monthly email that
 * declares a trend from two events to three is noise wearing a suit, and the
 * cost of a wrong headline is that the right one stops being believed.
 */
export function headline(current: MonthFigures, previous: MonthFigures): string {
  if (current.eventsCreated === 0) {
    return previous.eventsCreated === 0
      ? 'No events yet. Nothing has gone wrong — nothing has happened.'
      : 'No events created last month.';
  }
  // Below this, percentages are arithmetic rather than evidence.
  const ENOUGH = 10;
  if (current.eventsCreated < ENOUGH || previous.eventsCreated < ENOUGH) {
    return `${current.eventsCreated} event${current.eventsCreated === 1 ? '' : 's'} — still too few for month-over-month percentages to mean much.`;
  }
  if (current.successRate !== null && previous.successRate !== null) {
    const points = Math.round((current.successRate - previous.successRate) * 10) / 10;
    if (Math.abs(points) >= 10) {
      return points > 0
        ? `Successful events up ${points} points — more of what you sell is working.`
        : `Successful events down ${Math.abs(points)} points — worth looking at before anything else.`;
    }
  }
  const eventChange = delta(current.eventsCreated, previous.eventsCreated);
  return eventChange ? `Events ${eventChange} on the month.` : '';
}
