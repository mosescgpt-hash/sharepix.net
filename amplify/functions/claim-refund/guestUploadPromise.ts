/**
 * The claim function's copy of the Guest Upload Promise rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so these
 * rules exist twice. Everything below the header is byte-identical to
 * lib/guestUploadPromise.ts and __tests__/refunds.test.ts fails if it drifts.
 *
 * This copy is the one that decides. The app-side copy only decides which
 * button a host is shown.
 */

/** Uploads by anyone other than the host. Below this, the promise applies. */
export const QUALIFYING_UPLOAD_THRESHOLD = 1;

/** A claim cannot be filed before this many days after the event. */
export const CLAIM_OPENS_DAYS_AFTER = 7;

/** Or after this many. */
export const CLAIM_CLOSES_DAYS_AFTER = 21;

/** Which version of the promise an event was sold under. */
export const PROMISE_VERSION = 'v1';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PromiseEventFacts {
  tier?: string | null;
  paid?: boolean | null;
  /** Uploads from someone other than the host. See lib/successfulEvent.ts. */
  guestUploadCount?: number | null;
  /** The date the host set for the event, if any. */
  date?: string | null;
  createdAt?: string | null;
}

/**
 * When the clock starts.
 *
 * The event date the host entered, when they entered one, because that is what
 * the promise is about. Falling back to creation is imperfect — someone who
 * sets up two months ahead gets a window that opened and closed before their
 * event happened — which is exactly why an event with no date is refused a
 * claim outright below rather than being silently measured from the wrong day.
 */
export function promiseAnchor(event: PromiseEventFacts): Date | null {
  const raw = event.date ?? null;
  if (!raw) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? new Date(at) : null;
}

export type PromiseBlocker =
  | 'not-paid'
  | 'free-tier'
  | 'no-event-date'
  | 'guests-did-upload'
  | 'too-early'
  | 'too-late';

export interface PromiseEligibility {
  eligible: boolean;
  blocker: PromiseBlocker | null;
  /** Shown to the host. Plain, and never accusing them of anything. */
  message: string;
  opensAt: Date | null;
  closesAt: Date | null;
}

/**
 * Whether this event can claim, right now.
 *
 * Re-derived server-side on every claim. The host's browser decides what button
 * to show; it decides nothing about whether money moves.
 */
export function promiseEligibility(
  event: PromiseEventFacts | null | undefined,
  now: Date = new Date(),
): PromiseEligibility {
  const no = (blocker: PromiseBlocker, message: string, opensAt: Date | null = null, closesAt: Date | null = null): PromiseEligibility => ({
    eligible: false,
    blocker,
    message,
    opensAt,
    closesAt,
  });

  if (!event) return no('not-paid', 'This event could not be found.');

  // A free event cost nothing, so there is nothing to give back. Said kindly:
  // the host has not lost anything, and the answer is not "you are ineligible"
  // but "there is no money involved".
  if ((event.tier ?? '') === 'free') {
    return no('free-tier', 'A free event has nothing to refund.');
  }
  if (event.paid === false) {
    return no('not-paid', 'This event was never paid for.');
  }

  if ((event.guestUploadCount ?? 0) >= QUALIFYING_UPLOAD_THRESHOLD) {
    return no(
      'guests-did-upload',
      'Guests did upload to this event, so the Guest Upload Promise does not apply.',
    );
  }

  const anchor = promiseAnchor(event);
  if (!anchor) {
    // Deliberately refused rather than measured from creation. A window timed
    // off the wrong day would open and close before some events even happen,
    // and a host being told "too late" about an event next week would be worse
    // than being told to get in touch.
    return no(
      'no-event-date',
      'This event has no date set, so we cannot work out the claim window. Please get in touch and we will sort it out.',
    );
  }

  const opensAt = new Date(anchor.getTime() + CLAIM_OPENS_DAYS_AFTER * DAY_MS);
  const closesAt = new Date(anchor.getTime() + CLAIM_CLOSES_DAYS_AFTER * DAY_MS);

  if (now < opensAt) {
    return no(
      'too-early',
      'Photos sometimes arrive a few days late, so claims open a week after the event.',
      opensAt,
      closesAt,
    );
  }
  if (now >= closesAt) {
    return no(
      'too-late',
      'The claim window for this event has closed. Please get in touch if something went wrong.',
      opensAt,
      closesAt,
    );
  }

  return { eligible: true, blocker: null, message: '', opensAt, closesAt };
}

/** What the host is asked to confirm. A claim, not proof — see the header. */
export const ATTESTATION_QUESTION =
  'Did you make your SharePix QR code or event link available to guests at your event?';

/**
 * Whether a claim may be filed: eligible AND attested.
 *
 * Split from `promiseEligibility` because they fail for different reasons and
 * the host should be told which. "Not yet — claims open on the 14th" and "we
 * need you to confirm you put the code out" are different conversations.
 */
export function canFileClaim(
  event: PromiseEventFacts | null | undefined,
  attested: boolean,
  now: Date = new Date(),
): { ok: boolean; message: string } {
  const eligibility = promiseEligibility(event, now);
  if (!eligibility.eligible) return { ok: false, message: eligibility.message };
  if (!attested) {
    return {
      ok: false,
      message: 'Please confirm you made the QR code or event link available to guests.',
    };
  }
  return { ok: true, message: '' };
}
