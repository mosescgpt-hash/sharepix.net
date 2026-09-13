/**
 * The evidence for a refund decision, assembled in one place.
 *
 * Someone gets in touch unhappy. The question is always the same — what
 * actually happened at this event? — and until now answering it meant reading
 * three tables by hand while a customer waited.
 *
 * ## The rule this module exists to stop breaking
 *
 * **Few uploaders is not a failure.** A christening with one aunt taking
 * photos, a small dinner, a shoot where the host wanted exactly one person
 * uploading: all normal, all working as sold. SharePix already has a metric
 * called Successful Event (3 contributors, 10 uploads) and it would be very
 * easy to reach for it here, because it is sitting right there and it returns a
 * boolean. It is the wrong instrument. lib/successfulEvent.ts says so in its
 * own header — it measures whether the *product* works across a population, and
 * it is explicitly not a judgement of a customer.
 *
 * So this module reports Successful Event as context and refuses to let it
 * decide anything. `refundOwed` is computed from the Guest Upload Promise
 * alone, which asks a question with an actual answer: did *anyone* other than
 * the host upload? One guest upload means the product did what it promised, and
 * one is the threshold.
 *
 * ## Owed, and everything else
 *
 * Two outcomes, kept apart on purpose:
 *
 * - **Owed.** The promise applies: paid, in window, zero guest uploads. This is
 *   contractual and it is not a judgement call.
 * - **Discretionary.** Everything else. The facts are laid out and a person
 *   decides. Most real complaints land here, and there is no formula for them —
 *   a host whose guests uploaded twice may still deserve their money back, and
 *   that is a decision a person makes with the counts in front of them.
 *
 * Nothing here moves money, the same as the rest of the refund path. It reads.
 */

import { formatCents } from './refunds';
import {
  promiseEligibility,
  type PromiseEventFacts,
  type PromiseBlocker,
} from './guestUploadPromise';
import { successProgress, type EventSuccessFacts } from './successfulEvent';

export interface ReviewEventFacts extends PromiseEventFacts, EventSuccessFacts {
  id: string;
  name?: string | null;
  eventCode?: string | null;
  photoCount?: number | null;
}

/** A refund already recorded against this event. */
export interface ReviewRefundRow {
  id: string;
  amountCents?: number | null;
  status?: string | null;
  reason?: string | null;
  createdAt?: string | null;
}

export type RefundStance = 'owed' | 'discretionary';

export interface ReviewFinding {
  /** Short label, e.g. "Guest uploads". */
  label: string;
  /** The value as text, already formatted. Never a bare null. */
  value: string;
  /**
   * What this fact means for the decision, in one line — or null when it is
   * context rather than evidence. Written for a person to read aloud to a
   * customer, because that is what it is for.
   */
  note: string | null;
}

export interface EventReview {
  stance: RefundStance;
  /** One sentence. The thing to read first. */
  headline: string;
  findings: ReviewFinding[];
  /** Refunds already on file, so nothing is paid twice. */
  priorRefunds: ReviewRefundRow[];
  /** Total already recorded as refunded or pending, in cents. */
  alreadyRefundedCents: number;
  /** Why the promise did not apply, when it did not. For the audit trail. */
  promiseBlocker: PromiseBlocker | null;
}

/** Statuses that mean money is spoken for. A rejected row is not. */
const COMMITTED = new Set(['PENDING', 'APPROVED', 'PAID', 'REFUNDED']);

function committedCents(refunds: ReviewRefundRow[]): number {
  return refunds
    .filter((row) => COMMITTED.has((row.status ?? '').toUpperCase()))
    .reduce((sum, row) => sum + Math.max(0, row.amountCents ?? 0), 0);
}

/**
 * Everything a person needs to decide, and nothing that decides for them.
 */
export function reviewEvent(
  event: ReviewEventFacts,
  refunds: ReviewRefundRow[] = [],
  now: Date = new Date(),
): EventReview {
  const eligibility = promiseEligibility(event, now);
  const progress = successProgress(event);
  const guestUploads = Math.max(0, event.guestUploadCount ?? 0);
  const totalPhotos = Math.max(0, event.photoCount ?? 0);
  // Uploads the host made themselves. Never negative, even if the two counters
  // disagree — a negative "host uploads" on an admin screen would send somebody
  // hunting for a bug that is really just a stale counter.
  const hostUploads = Math.max(0, totalPhotos - guestUploads);

  const stance: RefundStance = eligibility.eligible ? 'owed' : 'discretionary';

  const findings: ReviewFinding[] = [
    {
      label: 'Photos in the gallery',
      value: String(totalPhotos),
      note: totalPhotos === 0 ? 'Nothing was ever uploaded, by anyone.' : null,
    },
    {
      label: 'Guest uploads',
      value: String(guestUploads),
      note:
        guestUploads === 0
          ? 'Nobody but the host uploaded. This is what the Guest Upload Promise is about.'
          : 'Guests did upload, so the promise does not apply. A refund here is a judgement call.',
    },
    {
      label: 'Uploaded by the host',
      value: String(hostUploads),
      note: null,
    },
    {
      label: 'Unique contributors',
      value: String(progress.contributors),
      // The rule this module exists to protect, said where it will be read.
      note:
        progress.contributors <= 1
          ? 'One uploader is normal for plenty of events and is not itself a fault.'
          : null,
    },
    {
      label: 'Successful Event',
      value: progress.successful
        ? 'Yes'
        : `No — short ${progress.contributorsShort} contributors, ${progress.guestUploadsShort} uploads`,
      note: 'A product measure across all events. Not a refund criterion.',
    },
    {
      label: 'Event date',
      value: (event.date ?? '').trim() || 'Not set',
      note: (event.date ?? '').trim()
        ? null
        : 'With no date there is no claim window, so the promise cannot be assessed automatically.',
    },
    {
      label: 'Claim window',
      value:
        eligibility.opensAt && eligibility.closesAt
          ? `${eligibility.opensAt.toISOString().slice(0, 10)} to ${eligibility.closesAt
              .toISOString()
              .slice(0, 10)}`
          : 'Not applicable',
      note: null,
    },
  ];

  const alreadyRefundedCents = committedCents(refunds);
  if (alreadyRefundedCents > 0) {
    findings.push({
      label: 'Already refunded',
      value: formatCents(alreadyRefundedCents),
      note: 'Check this before agreeing to anything further.',
    });
  }

  return {
    stance,
    headline: eligibility.eligible
      ? 'The Guest Upload Promise applies. This refund is owed, not discretionary.'
      : `The promise does not apply: ${eligibility.message || 'see the findings below.'} Any refund here is a judgement call.`,
    findings,
    priorRefunds: refunds,
    alreadyRefundedCents,
    promiseBlocker: eligibility.blocker,
  };
}
