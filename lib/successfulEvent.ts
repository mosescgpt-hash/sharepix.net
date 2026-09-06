/**
 * What makes an event a *Successful Event*.
 *
 * One definition, in one place, because roughly seven of the strategy
 * documents key off this metric and every one of them assumes the same number.
 * A monthly report, a survey trigger and a growth-loop step that each computed
 * "successful" slightly differently would disagree in public.
 *
 *   Successful Event = at least 3 unique guest contributors
 *                      AND at least 10 guest uploads
 *
 * Both halves are needed and neither is sufficient. Ten uploads from one person
 * is a host testing their own event; three people uploading one photo each is a
 * gallery nobody came back to. The pair is what says the QR code actually went
 * round a room.
 *
 * ## What this metric is NOT
 *
 * It is not a judgement shown to hosts. "Your event was unsuccessful" is a
 * horrible sentence to put in front of someone whose wedding it was, and the
 * number exists to tell us whether the product works, not to grade a customer.
 * It is admin-facing on purpose.
 *
 * ## How much weight it can carry
 *
 * A contributor is identified by the name (or per-browser guest label) attached
 * to an upload, which is a client-supplied string. It cannot be forged by
 * accident, but it can be forged on purpose, and the incentive to do so is real
 * once this metric gates a $25 gift card. That is survivable precisely because
 * the gift card is issued by hand — a person looks at the event before paying.
 * Treat this as a good measure and a weak control, and do not wire it to
 * anything that spends money on its own.
 */

/** Unique guest contributors an event needs. Configurable per the brief. */
export const SUCCESS_MIN_CONTRIBUTORS = 3;

/** Guest uploads an event needs. Photos and videos both count. */
export const SUCCESS_MIN_GUEST_UPLOADS = 10;

export interface SuccessThresholds {
  minContributors: number;
  minGuestUploads: number;
}

export const DEFAULT_SUCCESS_THRESHOLDS: SuccessThresholds = {
  minContributors: SUCCESS_MIN_CONTRIBUTORS,
  minGuestUploads: SUCCESS_MIN_GUEST_UPLOADS,
};

/** The two counters an event carries, as stored on its row. */
export interface EventSuccessFacts {
  contributorCount?: number | null;
  guestUploadCount?: number | null;
}

/**
 * Strip characters that have no business in a stored identifier.
 *
 * A character scan rather than a regex: the control-character ranges are
 * exactly the thing that keeps getting mis-escaped in a character class, and
 * this is unambiguous. Tab and newline are dropped here too — unlike free text
 * elsewhere in the product, an uploader label has no legitimate use for them,
 * and keeping them would let "Maya" and "Maya\n" count as two people.
 */
function stripForKey(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32) continue;
    if (code >= 127 && code <= 159) continue;
    out += char;
  }
  return out;
}

/**
 * The key that decides whether two uploads came from the same contributor.
 *
 * Case-folded and whitespace-collapsed, so "Aunt Maya", "aunt maya" and
 * "Aunt  Maya " are one person rather than three. That is the right call in
 * both directions: the same guest typing their name slightly differently on a
 * second upload is overwhelmingly more common than two guests at one event
 * whose names differ only by case.
 *
 * Returns null for anything that carries no identity — empty, whitespace, or
 * the legacy "Anonymous" that every unnamed upload used to collapse into.
 * Counting "Anonymous" as one contributor would mean an event where forty
 * guests all skipped the name box scored one, and treating it as forty would be
 * an invention. Null means "cannot tell", and cannot-tell is not a contributor.
 *
 * Uploads made before the per-browser guest label existed therefore do not
 * count toward this metric. That is a real gap in historical data and it is the
 * honest answer for it.
 */
export function contributorKey(uploadedBy: string | null | undefined): string | null {
  const cleaned = stripForKey(uploadedBy ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return null;
  if (cleaned === 'anonymous') return null;
  return cleaned.slice(0, 60);
}

/** The row id that makes a contributor unique within one event. */
export function contributorRowId(eventId: string, key: string): string {
  return `${eventId}#${key}`;
}

/** Whether an event has cleared both thresholds. */
export function isSuccessfulEvent(
  facts: EventSuccessFacts | null | undefined,
  thresholds: SuccessThresholds = DEFAULT_SUCCESS_THRESHOLDS,
): boolean {
  if (!facts) return false;
  const contributors = facts.contributorCount ?? 0;
  const uploads = facts.guestUploadCount ?? 0;
  return contributors >= thresholds.minContributors && uploads >= thresholds.minGuestUploads;
}

export interface SuccessProgress {
  successful: boolean;
  contributors: number;
  guestUploads: number;
  /** How many more unique contributors are needed. 0 once cleared. */
  contributorsShort: number;
  /** How many more guest uploads are needed. 0 once cleared. */
  guestUploadsShort: number;
  /** Which half is holding it back, for a one-line admin summary. */
  blockedBy: 'none' | 'contributors' | 'uploads' | 'both';
}

/**
 * Both counters and what is still missing.
 *
 * Reports the shortfall on each half separately rather than a single percentage,
 * because the two failures mean completely different things: short on uploads
 * is a quiet event, short on contributors is an event one person carried.
 */
export function successProgress(
  facts: EventSuccessFacts | null | undefined,
  thresholds: SuccessThresholds = DEFAULT_SUCCESS_THRESHOLDS,
): SuccessProgress {
  const contributors = Math.max(0, facts?.contributorCount ?? 0);
  const guestUploads = Math.max(0, facts?.guestUploadCount ?? 0);
  const contributorsShort = Math.max(0, thresholds.minContributors - contributors);
  const guestUploadsShort = Math.max(0, thresholds.minGuestUploads - guestUploads);
  const successful = contributorsShort === 0 && guestUploadsShort === 0;
  let blockedBy: SuccessProgress['blockedBy'] = 'none';
  if (contributorsShort > 0 && guestUploadsShort > 0) blockedBy = 'both';
  else if (contributorsShort > 0) blockedBy = 'contributors';
  else if (guestUploadsShort > 0) blockedBy = 'uploads';
  return {
    successful,
    contributors,
    guestUploads,
    contributorsShort,
    guestUploadsShort,
    blockedBy,
  };
}

/**
 * The share of events that succeeded, as a percentage rounded to one decimal.
 *
 * Returns null rather than 0 for an empty set. Zero would be reported as "0.0%
 * of events succeeded", which reads as a catastrophe rather than as no events.
 */
export function successRate(events: EventSuccessFacts[]): number | null {
  if (events.length === 0) return null;
  const won = events.filter((event) => isSuccessfulEvent(event)).length;
  return Math.round((won / events.length) * 1000) / 10;
}
