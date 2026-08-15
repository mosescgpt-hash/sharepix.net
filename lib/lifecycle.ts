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
