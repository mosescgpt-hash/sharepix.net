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
}

export interface CorporateSeatFacts {
  included: number;
  inUse: number;
  nextFreeAt: string | null;
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
  | { kind: 'corporate-seats'; tone: 'info' | 'warn'; title: string; body: string };

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

  // Waiting on payment. Before this, the dashboard looked exactly like a live
  // event's while every guest upload was refused — and a Corporate event past
  // the included slots is created this way on purpose.
  if (facts.paid === false) {
    const corporate = tier === 'corporate';
    notices.push({
      kind: 'unpaid',
      tone: 'warn',
      title: 'This event is not live yet',
      body: corporate
        ? `All ${CORPORATE_PLAN.includedEvents} of your included Corporate events were running when you created this one, so it is an extra event. Guests cannot upload or sign the guest book until it is paid.`
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

  // How many included slots are busy, so the $49 for the eleventh is a choice
  // a host makes rather than a surprise at checkout.
  if (tier === 'corporate' && seats) {
    const full = seats.inUse >= seats.included;
    const next = seats.nextFreeAt ? new Date(seats.nextFreeAt) : null;
    notices.push({
      kind: 'corporate-seats',
      tone: full ? 'warn' : 'info',
      title: `${Math.min(seats.inUse, seats.included)} of ${seats.included} included events running`,
      body: full
        ? `Your next event will be an extra event at $${CORPORATE_PLAN.extraEventPrice}${
            next && Number.isFinite(next.getTime())
              ? `, unless you wait until ${day(next)} when the next slot frees up`
              : ''
          }. A slot frees up when an event's upload window closes.`
        : `You can start ${seats.included - seats.inUse} more without paying extra. A slot frees up when an event's upload window closes.`,
    });
  }

  return notices;
}
