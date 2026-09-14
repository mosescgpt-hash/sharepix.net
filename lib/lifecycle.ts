import { ARCHIVE_DAYS, CORPORATE_PLAN, getTier } from './pricing';
import type { QREvent } from './types';
// Safe in this direction only: storageReclaim.ts has no imports of its own —
// it is copied verbatim into the reclaim Lambda, which cannot resolve lib/ —
// so nothing there can import back and make a cycle.
import { daysUntilReclaim, lifespanDays } from './storageReclaim';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What a guest is allowed to see at a given point in an event's life. */
export type GuestResolution = 'larger' | 'small' | 'none';

export interface EventLifecycle {
  /** Guests may still upload. */
  uploadOpen: boolean;
  /** Resolution guests may view: full display, small, or nothing. */
  guestResolution: GuestResolution;
  /** Host can still view/download (event not yet archived). */
  hostAccess: boolean;
  /** Event is in the hidden admin-only archive window. */
  archived: boolean;
  uploadWindowEndsAt: Date | null;
  retentionEndsAt: Date | null;
  /**
   * When the admin-only archive window closes and the event stops being
   * recoverable. Null for an event with no window (created before the
   * lifecycle model), which never archives.
   */
  archiveEndsAt: Date | null;
}

/**
 * Resolve where an event sits in its lifecycle:
 *   open (uploads + larger view) → guests low-res → guests nothing,
 *   with the host keeping access through the plan's retention period, after
 *   which the event archives (admin-only) and is eventually deleted.
 *
 * Events created before this model (no uploadWindowEndsAt) are treated as fully
 * open with host access, for backward compatibility.
 */
/**
 * How long an event's gallery lasts, in days.
 *
 * Corporate events are not a tier in PRICING_TIERS — the subscription is, and
 * the events under it carry `tier: 'corporate'` with no row to look up. So
 * every reader of retention has to special-case it, and this was written out
 * twice in this file before the reclaim countdown needed a third copy.
 *
 * The 90-day fallback is for a tier string that resolves to nothing: an event
 * from a plan that no longer exists, or a typo. Erring short would delete
 * somebody's photographs early, so it matches the shortest retired plan rather
 * than zero.
 */
export function retentionDaysFor(event: Pick<QREvent, 'tier'>): number {
  if (event.tier === 'corporate') return CORPORATE_PLAN.retentionDays;
  return getTier(event.tier)?.retentionDays ?? 90;
}

export function eventLifecycle(
  event:
    | Pick<QREvent, 'tier' | 'uploadWindowEndsAt' | 'uploadsClosed'>
    | null
    | undefined,
  now: Date = new Date(),
): EventLifecycle {
  if (!event) {
    return {
      uploadOpen: false,
      guestResolution: 'none',
      hostAccess: false,
      archived: false,
      uploadWindowEndsAt: null,
      retentionEndsAt: null,
      archiveEndsAt: null,
    };
  }

  const windowEnd = event.uploadWindowEndsAt ? new Date(event.uploadWindowEndsAt) : null;

  if (!windowEnd || Number.isNaN(windowEnd.getTime())) {
    return {
      uploadOpen: !event.uploadsClosed,
      guestResolution: 'larger',
      hostAccess: true,
      archived: false,
      uploadWindowEndsAt: null,
      retentionEndsAt: null,
      archiveEndsAt: null,
    };
  }

  const tier = getTier(event.tier);
  const isCorporate = event.tier === 'corporate';
  const lowResDays = isCorporate
    ? CORPORATE_PLAN.guestLowResDays
    : tier?.guestLowResDays ?? 30;
  const retentionDays = retentionDaysFor(event);
  const guestNothingAt = new Date(windowEnd.getTime() + lowResDays * DAY_MS);
  const retentionEnd = new Date(windowEnd.getTime() + retentionDays * DAY_MS);
  const archiveEnd = new Date(retentionEnd.getTime() + ARCHIVE_DAYS * DAY_MS);

  const beforeWindow = now < windowEnd;
  const uploadOpen = beforeWindow && !event.uploadsClosed;

  let guestResolution: GuestResolution;
  if (beforeWindow) guestResolution = 'larger';
  else if (now < guestNothingAt) guestResolution = 'small';
  else guestResolution = 'none';

  return {
    uploadOpen,
    guestResolution,
    hostAccess: now < retentionEnd,
    archived: now >= retentionEnd && now < archiveEnd,
    uploadWindowEndsAt: windowEnd,
    retentionEndsAt: retentionEnd,
    archiveEndsAt: archiveEnd,
  };
}

/**
 * The `uploadWindowEndsAt` that puts an event at the very start of its archive
 * window: guests see nothing, the host loses access, and the event is
 * admin-only but still recoverable.
 *
 * Computed rather than hard-coded because retention differs per plan, and it
 * lands the event just past the retention boundary rather than deep into the
 * archive — so archiving by hand does not quietly burn part of the recovery
 * period the host would get back.
 */
export function archiveWindowEnd(
  event: Pick<QREvent, 'tier'>,
  now: Date = new Date(),
): string {
  const retentionDays = retentionDaysFor(event);
  // One minute past the boundary, so `archived` is true immediately rather
  // than depending on clock skew between here and the next render.
  return new Date(now.getTime() - retentionDays * DAY_MS - 60_000).toISOString();
}

/**
 * How long each sellable plan's media lives, as a sentence for the operator.
 *
 * `/global-admin` said "every event whose 12-month gallery and 90-day archive
 * have both closed" until somebody checked. That is true of the paid plans and
 * wrong about Free, whose media ages out in about six months — so an operator
 * reading a non-zero dry run against that sentence would have taken it for a
 * bug rather than for the early test events it actually was. On the screen that
 * arms the only job in the product that destroys data, that is the wrong thing
 * to be vague about.
 *
 * ## Why it lives here and not in lib/storageReclaim.ts
 *
 * That module is copied verbatim into the reclaim Lambda, with a test that
 * compares the two byte for byte. This is a string builder for one admin
 * screen: the Lambda has no use for it, and putting it there would ship dead
 * code into the bundle and couple a sentence to the module that decides what
 * gets deleted. The drift guard is worth more than the convenience.
 *
 * Months rather than days, because the reader is deciding whether to arm a
 * destructive job, not computing a date.
 */
export function reclaimSpread(
  plans: readonly { name: string; retentionDays?: number | null }[],
  uploadWindowDays: number,
): string {
  const months = (plan: { retentionDays?: number | null }) =>
    (uploadWindowDays + lifespanDays(plan.retentionDays ?? NaN)) / 30.4;

  // One entry per distinct figure: three plans that all land on 17.2 months
  // should read as one number, not as three repetitions of it.
  const byFigure = new Map<string, string[]>();
  for (const plan of plans) {
    const key = months(plan).toFixed(1);
    byFigure.set(key, [...(byFigure.get(key) ?? []), plan.name]);
  }

  return [...byFigure.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    // No trailing "after the event is created" per entry — the page says it
    // once. Repeating it three times is how a derived sentence ends up reading
    // worse than the hardcoded one it replaced.
    .map(([figure, names]) => `${names.join(' and ')} at about ${figure} months`)
    .join('; ');
}

/**
 * When an event's media will be deleted, as a phrase for the operator.
 *
 * The reclaim job runs weekly and removes files permanently, and until now
 * nothing anywhere showed which events it was about to take. The only way to
 * find out was to run the job and read a count — which gives you a number and
 * not a list, at the moment it is already too late to object.
 *
 * `daysUntilReclaim` has existed since reclamation shipped, with a comment
 * saying it was there "so an admin screen can show 'in 12 days'". It was never
 * called. This is that screen.
 *
 * Deliberately vague past a fortnight. "In 3 days" is a thing to act on; "in
 * 287 days" is noise dressed as precision, and a dashboard that renders it for
 * every row buries the two that matter.
 */
export function reclaimPhrase(
  event: Pick<QREvent, 'tier' | 'uploadWindowEndsAt' | 'mediaReclaimedAt'>,
  now: Date = new Date(),
): { text: string; urgent: boolean } | null {
  if (event.mediaReclaimedAt) return { text: 'Media already deleted', urgent: false };

  const days = daysUntilReclaim(event, retentionDaysFor(event), now);
  // No anchor date means the job will refuse to touch it, so there is nothing
  // to count down to and saying "unknown" would imply a risk that is not there.
  if (days === null) return null;

  if (days <= 0) return { text: 'Due for deletion', urgent: true };
  if (days === 1) return { text: 'Deletes tomorrow', urgent: true };
  if (days <= 14) return { text: `Deletes in ${days} days`, urgent: true };
  if (days <= 60) return { text: `Deletes in about ${Math.round(days / 7)} weeks`, urgent: false };
  return { text: `Deletes in about ${Math.round(days / 30.4)} months`, urgent: false };
}
