/**
 * When an event's media may actually be deleted.
 *
 * ## What this decides
 *
 * The retention promise is: guests upload for 60 days, the gallery stays for 12
 * months, then a 90-day admin-only archive, then the media is gone. Every part
 * of that except the last already worked — `lib/lifecycle.ts` has computed the
 * dates since retention shipped, and access has been correctly cut off at each
 * boundary. Nothing ever deleted the bytes.
 *
 * That mattered more once "unlimited photos" became the plan: unlimited storage
 * held forever on a one-time payment is an unbounded liability, and the thing
 * that bounds it is this file being right.
 *
 * ## This is the most destructive code in the product
 *
 * Everything here is written on the assumption that deleting a customer's
 * photos early is unrecoverable and unforgivable, and that deleting them late
 * costs pennies. Every judgement call therefore resolves toward NOT deleting:
 *
 *   - An event with **no upload window date cannot ever be reclaimed.** Not
 *     "treated as old", not "measured from creation" — never. A missing date is
 *     missing information, and guessing an anchor for a destructive action is
 *     how you delete a wedding that has not happened yet.
 *
 *   - An **unparseable** date is the same as a missing one.
 *
 *   - A `GRACE_DAYS` margin sits past the archive boundary, so an extension
 *     that landed while a job was mid-run, or a clock a few hours out, cannot
 *     bring deletion forward.
 *
 *   - An event an admin has **restored** or otherwise touched into a state this
 *     does not understand is skipped rather than guessed at.
 *
 * The reclaim job additionally refuses to run at all unless explicitly switched
 * on, and logs everything it would have deleted first. See the function.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The admin-only archive window, in days.
 *
 * Duplicated from lib/pricing.ts rather than imported, because this file is
 * copied verbatim into a Lambda and Amplify function bundles cannot import
 * from lib/. A test asserts the two are equal — a drift where THIS number is
 * larger delays deletion (harmless), and one where it is smaller deletes
 * during a window the host was told they could still recover from.
 */
export const ARCHIVE_DAYS = 90;

/** The fallback when a tier id resolves to nothing. Matches lib/lifecycle.ts. */
export const FALLBACK_RETENTION_DAYS = 90;

/**
 * Extra days past the archive boundary before anything is deleted.
 *
 * Not paranoia about arithmetic — about the gap between a decision and its
 * consequence. An extension purchased on the last day of the archive has to
 * propagate to the event row before a job that runs on a schedule reads it, and
 * a week of storage costs less than one host's photos.
 */
export const GRACE_DAYS = 7;

export interface ReclaimFacts {
  id?: string | null;
  tier?: string | null;
  uploadWindowEndsAt?: string | null;
  /** Set once the media has actually been removed. Stops a second pass. */
  mediaReclaimedAt?: string | null;
}

export type ReclaimVerdict =
  | { reclaim: true; deleteAfter: Date; reason: 'archive-expired' }
  | {
      reclaim: false;
      deleteAfter: Date | null;
      reason: 'no-window-date' | 'unparseable-date' | 'not-yet' | 'already-reclaimed' | 'no-event';
    };

/**
 * How long an event's media lives, in total, from the close of its upload
 * window: the plan's gallery retention, the archive, and the grace margin.
 */
export function lifespanDays(retentionDays: number): number {
  // Guard the input rather than trusting it: a caller passing NaN or a negative
  // through a tier lookup that failed would otherwise produce a deletion date
  // in the past for every event at once.
  const safe =
    Number.isFinite(retentionDays) && retentionDays > 0
      ? retentionDays
      : FALLBACK_RETENTION_DAYS;
  return safe + ARCHIVE_DAYS + GRACE_DAYS;
}

/**
 * Whether this event's media may be deleted now.
 *
 * Returns the date deletion becomes due alongside the verdict, so an admin
 * screen can show "in 12 days" rather than only "not yet".
 */
export function reclaimVerdict(
  event: ReclaimFacts | null | undefined,
  retentionDays: number,
  now: Date = new Date(),
): ReclaimVerdict {
  if (!event) return { reclaim: false, deleteAfter: null, reason: 'no-event' };
  if (event.mediaReclaimedAt) {
    return { reclaim: false, deleteAfter: null, reason: 'already-reclaimed' };
  }

  // The two refusals that matter most. An event with no anchor is not old — it
  // is unknown, and deleting on an assumption about it is the failure this
  // whole file exists to prevent.
  if (!event.uploadWindowEndsAt) {
    return { reclaim: false, deleteAfter: null, reason: 'no-window-date' };
  }
  const windowEnd = Date.parse(event.uploadWindowEndsAt);
  if (!Number.isFinite(windowEnd)) {
    return { reclaim: false, deleteAfter: null, reason: 'unparseable-date' };
  }

  const deleteAfter = new Date(windowEnd + lifespanDays(retentionDays) * DAY_MS);
  if (now.getTime() < deleteAfter.getTime()) {
    return { reclaim: false, deleteAfter, reason: 'not-yet' };
  }
  return { reclaim: true, deleteAfter, reason: 'archive-expired' };
}

/** Convenience for the admin screen: days until deletion, or null. */
export function daysUntilReclaim(
  event: ReclaimFacts | null | undefined,
  retentionDays: number,
  now: Date = new Date(),
): number | null {
  const verdict = reclaimVerdict(event, retentionDays, now);
  if (!verdict.deleteAfter) return null;
  return Math.ceil((verdict.deleteAfter.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Every stored object belonging to one photo record.
 *
 * All three, because the thumbnail was being left behind: it is mirrored to R2
 * like the others and serves real bytes. Blank and missing keys are dropped, so
 * a partially-written record cannot produce a delete against an empty key —
 * which, depending on the SDK and the store, is either a no-op or something
 * much worse.
 */
export function storedKeysOf(photo: {
  s3Key?: string | null;
  previewS3Key?: string | null;
  thumbS3Key?: string | null;
}): string[] {
  return [photo.s3Key, photo.previewS3Key, photo.thumbS3Key].filter(
    (key): key is string => typeof key === 'string' && key.trim().length > 0,
  );
}

/** What one run did, for the operator's summary. */
export interface ReclaimOutcome {
  eventsConsidered: number;
  eventsReclaimed: number;
  photosDeleted: number;
  objectsDeleted: number;
  bytesFreed: number;
  /** Events that were due but skipped, and why. */
  skipped: Array<{ eventId: string; reason: string }>;
  dryRun: boolean;
}

/**
 * The operator's sentence.
 *
 * Leads with whether anything was actually deleted, because that is the one
 * thing nobody should have to infer from a bag of counters — and with the job
 * switched off the honest answer is "nothing was deleted, here is what would
 * have been".
 */
export function reclaimSummary(outcome: ReclaimOutcome): string {
  const events = `${outcome.eventsReclaimed} event${outcome.eventsReclaimed === 1 ? '' : 's'}`;
  const photos = `${outcome.photosDeleted} photo${outcome.photosDeleted === 1 ? '' : 's'}`;
  if (outcome.dryRun) {
    return [
      `Nothing was deleted — storage reclamation is switched off.`,
      `${events} (${photos}) are past their archive window and would have been removed.`,
      outcome.skipped.length > 0
        ? `${outcome.skipped.length} were skipped: ${summarizeSkips(outcome.skipped)}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return [
    `Deleted ${photos} from ${events}, freeing ${Math.round(outcome.bytesFreed / (1024 * 1024))} MB.`,
    outcome.skipped.length > 0
      ? `${outcome.skipped.length} skipped: ${summarizeSkips(outcome.skipped)}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function summarizeSkips(skipped: ReclaimOutcome['skipped']): string {
  const counts = new Map<string, number>();
  for (const item of skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, count]) => `${count} ${reason}`).join(', ');
}
