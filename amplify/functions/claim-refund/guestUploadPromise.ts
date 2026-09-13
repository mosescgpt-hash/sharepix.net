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

/** Which version of the promise a claim was filed under. */
export const PROMISE_VERSION = 'v2';

/**
 * What the host says they planned, asked when they file rather than at setup.
 *
 * Two options and no third, because "other" here would collect free text that
 * nobody can decide from. A host whose plan was neither of these picks the
 * closer one and says the rest in the note.
 */
export const PLANNED_USES = ['guests-upload', 'i-upload'] as const;

export type PlannedUse = (typeof PLANNED_USES)[number];

export function isPlannedUse(value: unknown): value is PlannedUse {
  return typeof value === 'string' && (PLANNED_USES as readonly string[]).includes(value);
}

export const PLANNED_USE_QUESTION = 'Which is closest to what you planned for this event?';

/**
 * The two answers, worded to weigh the same.
 *
 * This is the whole trick and it is easy to get wrong. Neither option mentions
 * refunds, money, guests failing to do something, or anything going wrong;
 * both describe an ordinary way to run an event, in the host's own terms. A
 * host reading them should not be able to tell which one pays — and if they
 * can, the question has stopped measuring intent and started measuring how
 * badly they want the money.
 *
 * Contrast ATTESTATION_QUESTION below, which is unavoidably leading: anybody
 * who wants a refund can see that "yes" is the answer that continues. That one
 * is a signed statement rather than a measurement, which is why it is asked
 * second and only on the path where it is relevant.
 */
export const PLANNED_USE_OPTIONS: ReadonlyArray<{ value: PlannedUse; label: string }> = [
  { value: 'guests-upload', label: 'I wanted guests to add their own photos' },
  { value: 'i-upload', label: 'I was going to add the photos myself and share them' },
];

/**
 * What a host is told when they planned to upload everything themselves.
 *
 * Not a rejection, and it does not argue. The promise covers a specific thing
 * that did not happen to them; something else may well have, and the sentence
 * ends by asking rather than closing the door.
 */
export const PLANNED_SOLO_MESSAGE =
  'The Guest Upload Promise covers events where guests were meant to add their own photos, so it does not apply here. That does not mean nothing went wrong — tell us what happened and we will take a look.';

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

export interface ClaimAnswers {
  /** Which of PLANNED_USE_OPTIONS the host chose. */
  plannedUse?: PlannedUse | string | null;
  /** ATTESTATION_QUESTION, ticked. */
  attested?: boolean | null;
}

/**
 * Whether a claim may be filed.
 *
 * Split from `promiseEligibility` because they fail for different reasons and
 * the host should be told which. "Not yet — claims open on the 14th", "this
 * promise does not cover what you planned" and "we need you to confirm you put
 * the code out" are three different conversations.
 *
 * The order is deliberate. Intent is asked before the attestation, so a host
 * who planned to upload everything themselves is never shown the leading
 * question at all — they are answered and sent to a person, rather than walked
 * through a form whose next step is a statement they have no reason to sign.
 */
export function canFileClaim(
  event: PromiseEventFacts | null | undefined,
  answers: ClaimAnswers,
  now: Date = new Date(),
): { ok: boolean; message: string } {
  const eligibility = promiseEligibility(event, now);
  if (!eligibility.eligible) return { ok: false, message: eligibility.message };

  if (!isPlannedUse(answers.plannedUse)) {
    // Includes the unanswered case. Never defaulted: picking one for them is
    // inventing the fact this whole question exists to establish.
    return { ok: false, message: `Please answer: ${PLANNED_USE_QUESTION}` };
  }
  if (answers.plannedUse === 'i-upload') {
    return { ok: false, message: PLANNED_SOLO_MESSAGE };
  }

  if (answers.attested !== true) {
    return {
      ok: false,
      message: 'Please confirm you made the QR code or event link available to guests.',
    };
  }
  return { ok: true, message: '' };
}
