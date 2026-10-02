/**
 * The notices at the top of a host's event dashboard, decided in one place.
 *
 * Each one exists because a host could otherwise be surprised by something
 * the system already knew: an event that is not live, a free gallery about to
 * disappear, or a Corporate event that is about to cost $49. Pure, so the
 * wording and the conditions are tested rather than eyeballed on a page.
 */
import { CORPORATE_PLAN, getTier, isTrialTier } from './pricing';

export interface StatusFacts {
  tier?: string | null;
  /** `false` only when the event is waiting on payment. Missing reads as paid. */
  paid?: boolean | null;
  uploadWindowEndsAt?: Date | null;
  /** When the gallery closes: the window plus the plan's retention. */
  galleryClosesAt?: Date | null;
  /** Set when SharePix closed the event for its content. */
  takenDownAt?: string | null;
}

export interface CorporateSeatFacts {
  included: number;
  /** Included events already used this UTC month. */
  used: number;
  /** When the allowance resets: the start of next UTC month. */
  resetsAt: string;
}

export type EventStatusNotice =
  | {
      kind: 'unpaid';
      tone: 'warn';
      title: string;
      body: string;
      /** Whole dollars, before any discount code applied at checkout. */
      priceUsd: number;
    }
  | { kind: 'trial'; tone: 'info'; title: string; body: string; upgradePriceUsd: number }
  | { kind: 'corporate-seats'; tone: 'info' | 'warn'; title: string; body: string }
  | { kind: 'taken-down'; tone: 'error'; title: string; body: string };

function day(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

export function eventStatusNotices(
  facts: StatusFacts | null | undefined,
  seats: CorporateSeatFacts | null = null,
): EventStatusNotice[] {
  if (!facts) return [];
  const tier = (facts.tier ?? '').toLowerCase();
  const notices: EventStatusNotice[] = [];

  // Closed by SharePix. Outranks everything else, and is the only notice: an
  // offer to pay or upgrade beside it would read as a way to undo it.
  if (facts.takenDownAt) {
    return [
      {
        kind: 'taken-down',
        tone: 'error',
        title: 'SharePix has closed this event',
        body: 'It was closed under our terms of service for its content. Uploads are stopped and the gallery is not available to you or your guests. If you think this is a mistake, contact support@sharepix.net.',
      },
    ];
  }

  // Waiting on payment. Before this, the dashboard looked exactly like a live
  // event's while every guest upload was refused — and a Corporate event past
  // the month's included events is created this way on purpose.
  if (facts.paid === false) {
    const corporate = tier === 'corporate';
    notices.push({
      kind: 'unpaid',
      tone: 'warn',
      title: 'This event is not live yet',
      body: corporate
        ? `You had already used this month's ${CORPORATE_PLAN.includedEvents} included Corporate events when you created this one, so it is an extra event. Guests cannot upload or sign the guest book until it is paid.`
        : 'Checkout was not finished. Guests cannot upload or sign the guest book until it is paid.',
      priceUsd: corporate ? CORPORATE_PLAN.extraEventPrice : (getTier(tier)?.price ?? 0),
    });
    return notices;
  }

  // A free event says when it disappears, because two weeks goes quickly and
  // there is no way to upgrade it in place — only to run the next one paid.
  if (isTrialTier(tier)) {
    const full = getTier('plus');
    const parts: string[] = [];
    if (facts.uploadWindowEndsAt) parts.push(`Uploads close on ${day(facts.uploadWindowEndsAt)}`);
    if (facts.galleryClosesAt) {
      parts.push(`the gallery closes on ${day(facts.galleryClosesAt)} and is then deleted`);
    }
    const when = parts.length
      ? `${parts.join(', and ')}. `
      : '';
    notices.push({
      kind: 'trial',
      tone: 'info',
      title: 'This is your free event',
      body: `${when}Download anything you want to keep before then. A free event cannot be upgraded or extended, so run the event that matters on the Full Event.`,
      upgradePriceUsd: full?.price ?? 0,
    });
  }

  // How many of this month's included events are used, so the $49 for the
  // eleventh is a choice a host makes rather than a surprise at checkout.
  if (tier === 'corporate' && seats) {
    const used = Math.min(seats.used, seats.included);
    const left = seats.included - used;
    const resets = new Date(seats.resetsAt);
    const when = Number.isFinite(resets.getTime()) ? ` on ${day(resets)}` : ' next month';
    notices.push({
      kind: 'corporate-seats',
      tone: left === 0 ? 'warn' : 'info',
      title: `${used} of ${seats.included} included events used this month`,
      body:
        left === 0
          ? `Any more this month are extra events at $${CORPORATE_PLAN.extraEventPrice} each. Your ${seats.included} included events come back${when}.`
          : `You can start ${left} more this month without paying extra. The count resets${when}, and there is no limit on how many run at once.`,
    });
  }

  return notices;
}
