/**
 * The completion function's copy of the research incentive rules.
 *
 * Byte-identical to lib/researchIncentive.ts below the header; the drift guard
 * is in __tests__/research-incentive.test.ts. This copy owns the one transition
 * that turns an invitation into money owed.
 */

/** What we owe, in whole dollars. Configurable; the brief starts it at $25. */
export const INCENTIVE_AMOUNT_USD = 25;

/** The only kind we issue today. Named so a second kind is a visible change. */
export const INCENTIVE_TYPE = 'AMAZON_GIFT_CARD_MANUAL' as const;

/**
 * The lifecycle of one obligation.
 *
 * `AWAITING_MANUAL_FULFILLMENT` is where every real one sits until a person
 * acts. There is deliberately no transition into `FULFILLED` that a scheduled
 * job or an API call can take on its own.
 */
export const INCENTIVE_STATUSES = [
  'PENDING',
  'ELIGIBLE',
  'AWAITING_MANUAL_FULFILLMENT',
  'FULFILLED',
  'FAILED',
  'CANCELED',
  'DISQUALIFIED',
] as const;

export type IncentiveStatus = (typeof INCENTIVE_STATUSES)[number];

/** Statuses from which nothing further happens. */
export const TERMINAL_STATUSES: readonly IncentiveStatus[] = [
  'FULFILLED',
  'CANCELED',
  'DISQUALIFIED',
];

/**
 * Which status changes are allowed.
 *
 * A map rather than scattered `if`s, because the expensive mistake here is a
 * path into FULFILLED that nobody meant to create — that is a gift card
 * recorded as sent that nobody sent, or sent twice.
 */
const ALLOWED: Record<IncentiveStatus, readonly IncentiveStatus[]> = {
  PENDING: ['ELIGIBLE', 'DISQUALIFIED', 'CANCELED'],
  ELIGIBLE: ['AWAITING_MANUAL_FULFILLMENT', 'DISQUALIFIED', 'CANCELED'],
  AWAITING_MANUAL_FULFILLMENT: ['FULFILLED', 'FAILED', 'CANCELED', 'DISQUALIFIED'],
  // A failed send can be retried by hand.
  FAILED: ['AWAITING_MANUAL_FULFILLMENT', 'CANCELED'],
  FULFILLED: [],
  CANCELED: [],
  DISQUALIFIED: [],
};

export function canTransition(from: IncentiveStatus, to: IncentiveStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function isTerminal(status: IncentiveStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Whether marking this fulfilled is something only a person may do.
 *
 * Always true, and a function rather than a constant so the call site reads as
 * a decision. Every automated path must consult this and refuse.
 */
export function requiresHumanFulfilment(): boolean {
  return true;
}

/** Everything an obligation records, per the brief. */
export interface IncentiveFacts {
  /** The host's owner string — who earned it. */
  customer: string;
  eventId: string;
  /** Which survey they completed, so a second survey is a second programme. */
  surveyId: string;
  completedAt: string;
  amountUsd: number;
  participantEmail: string;
}

/**
 * The id that makes one obligation per person per survey.
 *
 * Keyed on the event and the survey rather than on a submission, because the
 * thing being prevented is two gift-card obligations from one piece of
 * research — whether that comes from a double submission, a job retry, or
 * someone reloading the thank-you page.
 */
export function incentiveId(eventId: string, surveyId: string): string {
  return `${eventId}#${surveyId}`;
}

export interface EligibilityInput {
  /** Did they finish the survey? The only question that decides this. */
  surveyCompleted: boolean;
  /** Was this event part of the research programme? */
  enrolled: boolean;
  /** Do we have somewhere to send it? */
  participantEmail: string;
}

export interface Eligibility {
  eligible: boolean;
  /** Why not, for the admin queue. Empty when eligible. */
  reason: string;
}

/**
 * Whether this completion earns the gift card.
 *
 * Note what this function cannot see: the answers. It is given whether the
 * survey was completed, never what it said. That is the Part 14 rule expressed
 * as a type signature rather than as a promise — the information needed to
 * discriminate on sentiment is not in scope, so the discrimination cannot be
 * written by accident.
 */
export function eligibilityFor(input: EligibilityInput): Eligibility {
  if (!input.enrolled) {
    return { eligible: false, reason: 'This event is not in the research programme.' };
  }
  if (!input.surveyCompleted) {
    return { eligible: false, reason: 'The survey has not been completed.' };
  }
  if (!input.participantEmail.trim()) {
    return { eligible: false, reason: 'No email address to send a gift card to.' };
  }
  return { eligible: true, reason: '' };
}

/**
 * What the customer is told when they finish.
 *
 * Deliberately does NOT say the card has been sent, because it has not been —
 * a person has to buy it. Promising delivery we have not made is how a
 * goodwill programme becomes a complaint, and the gap between "earned" and
 * "sent" is exactly where that happens.
 *
 * `businessDays` is configurable and omitted entirely when unset, rather than
 * defaulting to a number nobody committed to.
 */
export function completionMessage(
  amountUsd: number = INCENTIVE_AMOUNT_USD,
  businessDays?: string,
): string {
  const base = `You've earned a $${amountUsd} Amazon gift card for completing the SharePix research survey. We'll send it to the email address associated with your research participation after we review and process your reward.`;
  const timing = businessDays
    ? ` Most rewards are processed by hand during this early research programme, usually within ${businessDays}.`
    : ' Most rewards are processed by hand during this early research programme.';
  return base + timing;
}
