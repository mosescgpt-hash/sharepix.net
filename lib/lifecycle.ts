import { ARCHIVE_DAYS, CORPORATE_PLAN, getTier } from './pricing';
import type { QREvent } from './types';

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
  const retentionDays = isCorporate
    ? CORPORATE_PLAN.retentionDays
    : tier?.retentionDays ?? 90;
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
  const isCorporate = event.tier === 'corporate';
  const retentionDays = isCorporate
    ? CORPORATE_PLAN.retentionDays
    : getTier(event.tier)?.retentionDays ?? 90;
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
  lifespanDays: (retentionDays: number) => number,
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
