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
 * decide anything. The stance comes from the Guest Upload Promise alone, which
 * asks two questions that have answers: did *anyone* other than the host
 * upload, and were guests meant to be uploading at all? One guest upload means
 * the product did what it promised. And a host who planned to add the photos
 * themselves — a church sharing with parents, a photographer delivering a
 * shoot — was never sold on guests uploading, so nothing was promised to them
 * that could fail.
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

import { COMMITTED_STATUSES, formatCents } from './refunds';
import {
  PLANNED_USE_OPTIONS,
  promiseEligibility,
  type PromiseEventFacts,
  type PromiseBlocker,
} from './guestUploadPromise';
import { successProgress, type EventSuccessFacts } from './successfulEvent';
import { parseAudience, reviewNote } from './eventAudience';

export interface ReviewEventFacts extends PromiseEventFacts, EventSuccessFacts {
  id: string;
  name?: string | null;
  eventCode?: string | null;
  photoCount?: number | null;
  /** What the host said at setup. See lib/eventAudience.ts. */
  uploadAudience?: string | null;
}

/** A refund already recorded against this event. */
export interface ReviewRefundRow {
  id: string;
  amountCents?: number | null;
  status?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  /**
   * What the host said they planned, from PLANNED_USE_OPTIONS.
   *
   * The one claim on the row that nothing can check. Worth reading beside the
   * counts: "I wanted guests to add their own photos" next to one uploader and
   * two hundred host photos is the shape a bad-faith claim takes, and it is
   * not subtle once both are on the same screen.
   */
  plannedUse?: string | null;
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

/** The host's answer in the words they were shown, not the stored slug. */
function labelForPlannedUse(value: string): string {
  return (
    PLANNED_USE_OPTIONS.find((option) => option.value === value)?.label ??
    // A value from an older claim, or one we no longer offer. Shown as-is
    // rather than dropped: an unrecognised answer is still what they said.
    value
  );
}

/**
 * Money already spoken for.
 *
 * Uses lib/refunds.ts's own list rather than a second one written here. The
 * first draft of this function invented ['PENDING', 'APPROVED', 'PAID',
 * 'REFUNDED'] — three of which are not statuses this system has — so RECORDED,
 * the one that means a person actually put the money back, was not counted.
 * That undercounts what has already gone out, which is the exact direction
 * that lets a second refund through on top of a first.
 */
function committedCents(refunds: ReviewRefundRow[]): number {
  const committed = new Set<string>(COMMITTED_STATUSES);
  return refunds
    .filter((row) => committed.has((row.status ?? '').toUpperCase()))
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
      // The setup-time answer, which is the one thing the counts cannot supply.
      // "One uploader" means something different when the host said at the
      // start that they would be the only one — that is not a disappointed
      // customer, it is the event they bought. Worded as what the host said
      // rather than as a fact, because that is what it is.
      label: 'Who was going to upload',
      value:
        parseAudience(event.uploadAudience) === 'host-only'
          ? 'The host, alone'
          : parseAudience(event.uploadAudience) === 'guests'
            ? 'The guests'
            : 'Not recorded',
      note: reviewNote(parseAudience(event.uploadAudience)),
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

  // Only when they have actually claimed. On an event with no claim there is
  // no answer, and an empty row here would read as one.
  const claimed = refunds.find((row) => (row.plannedUse ?? '').trim());
  if (claimed) {
    findings.push({
      label: 'The host said they planned',
      value: labelForPlannedUse(claimed.plannedUse ?? ''),
      note:
        guestUploads === 0 && progress.contributors <= 1 && hostUploads > 20
          ? 'Worth a second look: they say guests were meant to upload, and this gallery is one person with a lot of photos.'
          : 'Their answer, which nothing verifies.',
    });
  }

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
