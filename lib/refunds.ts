/**
 * Money returned to a customer, and the ledger that stops us returning more
 * than they gave us.
 *
 * ## Refunds are not gift cards
 *
 * A gift card is what somebody earns for doing research; a refund is what
 * somebody is owed when the product did not do its job. They go to different
 * places — an Amazon code to their inbox, a refund to the card they paid with —
 * and they must never be confused for one another. Offering a gift card to a
 * customer asking for their money back is the failure this distinction exists
 * to prevent.
 *
 * Practically, it means **a research gift card does not consume refundable
 * amount**. The Guest Upload Promise brief's stacking example — $49 paid, minus
 * a $25 research refund, leaves $24 of guarantee — assumed the incentive was
 * cash. It is not, so a claim can return the full purchase price to someone who
 * also received a gift card.
 *
 * ## Nothing here moves money
 *
 * There is no Stripe call in this module or anywhere it is used. A refund is
 * issued by a person, in Stripe, and then recorded here. That is the same
 * posture as the gift card and for the same reason: an automated payout path
 * is a new class of failure on a product whose only money movement today is
 * inbound. `RECORDED` means "a human refunded this and told us", never "we
 * refunded this".
 */

/** Every reason money goes back. Named so a ledger row explains itself. */
export const REFUND_REASONS = [
  /** No guest uploaded anything to a paid event. See lib/guestUploadPromise.ts. */
  'GUEST_UPLOAD_PROMISE',
  /** Something we built did not work. */
  'SERVICE_FAILURE',
  /** No obligation; we chose to. */
  'GOODWILL',
  /** The event did not happen. */
  'CANCELLATION',
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

/**
 * A claim's life.
 *
 * `RECORDED` is the terminal success state and means a person issued the refund
 * in Stripe and said so. There is deliberately no state meaning "we sent the
 * money", because nothing here can.
 */
export const REFUND_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'RECORDED',
  'DECLINED',
] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

const ALLOWED: Record<RefundStatus, readonly RefundStatus[]> = {
  REQUESTED: ['APPROVED', 'DECLINED'],
  // Approved but not yet paid out. Still declinable, because approving is a
  // decision and issuing is an act, and the gap between them is where someone
  // notices a mistake.
  APPROVED: ['RECORDED', 'DECLINED'],
  RECORDED: [],
  DECLINED: [],
};

export function canTransition(from: RefundStatus, to: RefundStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** Statuses that count against what is still refundable. */
export const COMMITTED_STATUSES: readonly RefundStatus[] = ['APPROVED', 'RECORDED'];

export interface LedgerRow {
  status?: string | null;
  amountCents?: number | null;
}

/**
 * How much of what they paid has already been committed back to them.
 *
 * `APPROVED` counts, not just `RECORDED`. An approved refund is money we have
 * decided to return and may not have pressed the button on yet — counting only
 * what has been paid out would let a second claim be approved against the same
 * money in the window between deciding and doing.
 */
export function committedCents(ledger: readonly LedgerRow[]): number {
  return ledger
    .filter((row) => COMMITTED_STATUSES.includes((row.status ?? '') as RefundStatus))
    .reduce((sum, row) => sum + Math.max(0, row.amountCents ?? 0), 0);
}

/**
 * What can still be returned for this event, in cents.
 *
 * Never negative, and never more than was paid. This is the whole stacking
 * rule: whatever combination of promise claims, goodwill and service failures
 * arrives, the total that goes back cannot exceed the total that came in.
 * Negative revenue through stacked refunds is the specific outcome being
 * engineered against.
 */
export function remainingRefundableCents(
  paidCents: number,
  ledger: readonly LedgerRow[],
): number {
  return Math.max(0, Math.max(0, paidCents) - committedCents(ledger));
}

export interface RefundDecision {
  allowed: boolean;
  /** What may be refunded, in cents. Zero when not allowed. */
  amountCents: number;
  /** Why not. Empty when allowed. Shown to an admin, not to a customer. */
  reason: string;
}

/**
 * Whether a refund of this size can be committed, and for how much.
 *
 * A request for more than remains is not refused outright — it is reduced to
 * what remains. Refusing would be technically defensible and practically
 * unhelpful: the person filing it wants the customer made whole, and the cap
 * is the thing that decides how whole that can be.
 */
export function refundDecision(
  requestedCents: number,
  paidCents: number,
  ledger: readonly LedgerRow[],
): RefundDecision {
  const remaining = remainingRefundableCents(paidCents, ledger);
  if (paidCents <= 0) {
    return {
      allowed: false,
      amountCents: 0,
      reason: 'Nothing was paid for this event, so there is nothing to refund.',
    };
  }
  if (remaining <= 0) {
    return {
      allowed: false,
      amountCents: 0,
      reason: 'The full amount paid has already been refunded.',
    };
  }
  const amount = Math.min(Math.max(0, Math.round(requestedCents)), remaining);
  if (amount <= 0) {
    return { allowed: false, amountCents: 0, reason: 'A refund must be more than zero.' };
  }
  return { allowed: true, amountCents: amount, reason: '' };
}

/** Dollars, for display. Refunds are stored in cents, like everything Stripe. */
export function formatCents(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/** One claim per event per reason: a second identical claim is the same claim. */
export function refundId(eventId: string, reason: RefundReason): string {
  return `${eventId}#${reason}`;
}
