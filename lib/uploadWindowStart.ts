/**
 * When an event's sixty-day upload window begins.
 *
 * ## The bug this exists to fix
 *
 * The window ran from the moment the event row was written. A host who set up
 * their wedding gallery six weeks early spent six of their sixty days before a
 * single guest arrived, and a host who set up three months early found uploads
 * already closed on the day of the event — having paid for a window they never
 * got to use.
 *
 * Nothing reported it. `uploadWindowEndsAt` was stamped at creation and every
 * downstream reader — the lifecycle bands, the reminder emails, the storage
 * reclaim, the guest upload check — honoured it exactly as written.
 *
 * So the window starts at the event, not at the paperwork.
 *
 * ## Three cases, because a date is optional
 *
 * **Dated, in the future.** The window runs from the end of the event's day.
 * That is the case the whole change is about.
 *
 * **Dated, today or in the past.** The event already happened and the host is
 * collecting photos now, so the window runs from creation. Deriving it from a
 * past date would hand somebody a gallery that closed before they opened it —
 * the failure above, inverted.
 *
 * **Undated.** The window runs from creation *provisionally*, and is re-stamped
 * once when the event reaches {@link ANCHOR_UPLOAD_COUNT} uploads. Five, not
 * one: hosts test their own QR code, and a single upload is as likely to be
 * that test as the start of a party. Five photos is an event happening.
 *
 * The re-stamp only ever moves the window later, and only once. See
 * {@link anchoredWindowEnd}.
 *
 * ## Why the date is capped
 *
 * Every day a host can push their event into the future is a day of storage
 * SharePix has already been paid for. Uncapped, "2099-06-01" is a permanent
 * gallery for seventy-nine dollars.
 *
 * {@link MAX_EVENT_DATE_DAYS_AHEAD} is the ceiling, and it is deliberately not
 * a year. A host booking a venue eighteen months out is not going to set their
 * photo gallery up on the same afternoon, and the ones who try can come back
 * — the refusal says so rather than silently clamping the date, because a date
 * quietly changed underneath somebody is worse than a date refused.
 *
 * There is a floor too, for the obvious typo: a four-digit year off by a
 * century parses perfectly and is nobody's event.
 *
 * ## A note on time zones
 *
 * `Event.date` is an `AWSDate` — a calendar day with no zone, because "the 14th
 * of June" is what a host means and where they are does not change it. This
 * module reads it as UTC. The worst case is a window that ends up to fourteen
 * hours away from a local end-of-day, against a sixty-day window. Carrying a
 * time zone through the whole lifecycle to fix that would be a great deal of
 * machinery for half a day of a sixty-day span.
 *
 * ## Copies
 *
 * Amplify functions cannot import from `lib/`, so this file is duplicated into
 * the three Lambdas that need it. `__tests__/upload-window-start.test.ts`
 * compares the copies byte for byte and fails if any of them drifts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The upload window every plan gets, in days. Mirrors UPLOAD_WINDOW_DAYS. */
export const UPLOAD_WINDOW_DAYS = 60;

/**
 * How far ahead an event may be dated.
 *
 * Ninety days. Long enough for anybody actually organising the event — invites
 * go out around then — and short enough that the storage this commits to is
 * bounded at roughly three months plus the window plus the gallery.
 */
export const MAX_EVENT_DATE_DAYS_AHEAD = 90;

/**
 * How far back an event may be dated. A year, which is not a policy so much as
 * a typo filter: "2025-06-14" for this year's June is a slip anybody makes.
 */
export const MAX_EVENT_DATE_DAYS_BEHIND = 365;

/**
 * The upload that says an undated event has begun.
 *
 * Five. A host photographs their own table card to check the code works, and
 * that upload looks exactly like a guest's. Five is past the point where it
 * could still be somebody testing.
 */
export const ANCHOR_UPLOAD_COUNT = 5;

export const EVENT_DATE_TOO_FAR_MESSAGE =
  `Pick an event date within the next ${MAX_EVENT_DATE_DAYS_AHEAD} days. ` +
  'Uploads open around your event, so setting one up further out than that ' +
  'would spend the window before the day arrives — come back nearer the time.';

export const EVENT_DATE_TOO_OLD_MESSAGE =
  'That date is more than a year ago. Check the year and try again.';

/** A calendar date as milliseconds at the end of that UTC day, or NaN. */
function endOfDay(date: string): number {
  const start = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(start) ? start + DAY_MS : NaN;
}

/**
 * Why this event date cannot be used, or null when it can.
 *
 * A date that is absent or not a calendar date is *not* a problem here — the
 * sanitizers already drop those to null, and an undated event is allowed. This
 * function answers only the question they do not: is the date reachable?
 */
export function eventDateProblem(
  date: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const raw = (date ?? '').trim();
  if (!raw) return null;
  const day = Date.parse(`${raw}T00:00:00Z`);
  if (!Number.isFinite(day)) return null;

  const today = now.getTime();
  if (day - today > MAX_EVENT_DATE_DAYS_AHEAD * DAY_MS) return EVENT_DATE_TOO_FAR_MESSAGE;
  if (today - day > MAX_EVENT_DATE_DAYS_BEHIND * DAY_MS) return EVENT_DATE_TOO_OLD_MESSAGE;
  return null;
}

/**
 * The latest date a host may pick, as YYYY-MM-DD.
 *
 * For the `max` attribute on the form's date input, so the browser's own picker
 * refuses what the server would refuse. The server check is the fence; this is
 * so nobody has to hit it.
 */
export function latestEventDate(now: Date = new Date()): string {
  return new Date(now.getTime() + MAX_EVENT_DATE_DAYS_AHEAD * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * When uploads close, for an event with this date, created now.
 *
 * Returns an ISO timestamp — the same shape `uploadWindowEndsAt` has always
 * had, so every reader downstream is unaffected. What changed is only what the
 * sixty days are counted from.
 */
export function windowEndsAtFor(
  date: string | null | undefined,
  now: Date = new Date(),
): string {
  const fromCreation = now.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS;
  const raw = (date ?? '').trim();
  if (!raw) return new Date(fromCreation).toISOString();

  const eventEnd = endOfDay(raw);
  // Unparseable, or already past: run from creation. A window derived from a
  // date that has been and gone would be closed on arrival.
  if (!Number.isFinite(eventEnd) || eventEnd <= now.getTime()) {
    return new Date(fromCreation).toISOString();
  }
  return new Date(eventEnd + UPLOAD_WINDOW_DAYS * DAY_MS).toISOString();
}

/**
 * When the gallery closes, given when the window does.
 *
 * `accessDays` on a plan has always been the window plus the retention period,
 * counted from creation. Now that the window can start later, the gallery has
 * to move with it — otherwise a host dated two months out would get a window
 * that outlived their own gallery, which is not a state any reader here
 * expects.
 */
export function accessExpiresAtFor(
  windowEndsAt: string,
  accessDays: number,
  now: Date = new Date(),
): string {
  const retentionDays = Math.max(0, accessDays - UPLOAD_WINDOW_DAYS);
  const windowEnd = Date.parse(windowEndsAt);
  const base = Number.isFinite(windowEnd) ? windowEnd : now.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS;
  return new Date(base + retentionDays * DAY_MS).toISOString();
}

export interface Rescheduled {
  uploadWindowEndsAt: string;
  /** Null when the stored gallery date could not be read, so leave it alone. */
  accessExpiresAt: string | null;
}

/**
 * The window and the gallery for an event whose date has just been changed.
 *
 * Only ever reached before the first upload, because the event's name and date
 * lock the moment a photo exists — see `update-event/settings.ts`. That is what
 * makes this safe to allow in both directions: an event with no photos has
 * nothing invested in its current window, and a host who set the date up a
 * month and then corrected it should not be holding a month of storage nobody
 * is going to use.
 *
 * It is also what closes the obvious hole. Without the identity lock, a host
 * could collect photos all through their window and keep pushing the date to
 * buy another sixty days, free, forever — which is the thing the upload-window
 * extension is sold to do.
 *
 * The gallery moves by the same amount the window does rather than being
 * recomputed from a plan, so an event keeps exactly the retention it was sold,
 * including anything an admin granted it.
 */
export function rescheduledWindow(
  facts: {
    date: string | null | undefined;
    currentEndsAt: string | null | undefined;
    currentAccessExpiresAt: string | null | undefined;
  },
  now: Date = new Date(),
): Rescheduled | null {
  const current = Date.parse(facts.currentEndsAt ?? '');
  // An event with no readable window has none, and uploadWindowClosed treats
  // that as open. Giving it one here would be a date edit quietly imposing a
  // deadline.
  if (!Number.isFinite(current)) return null;

  const next = windowEndsAtFor(facts.date, now);
  const shift = Date.parse(next) - current;
  if (shift === 0) return null;

  const access = Date.parse(facts.currentAccessExpiresAt ?? '');
  return {
    uploadWindowEndsAt: next,
    accessExpiresAt: Number.isFinite(access) ? new Date(access + shift).toISOString() : null,
  };
}

export interface AnchorFacts {
  /** The event's date, or null when it has none. */
  eventDate: string | null | undefined;
  /** The window as currently stored. */
  currentEndsAt: string | null | undefined;
  /** Whether the event has already been anchored. */
  alreadyAnchored: boolean;
  /** Uploads accepted before this one. */
  photoCountBefore: number;
}

/**
 * The new `uploadWindowEndsAt` for an undated event whose fifth upload has just
 * landed, or null to leave the window exactly as it is.
 *
 * Four conditions, and every one of them is there to stop this from firing when
 * it should not:
 *
 * - **Only an undated event.** A dated one already counts from the right place,
 *   and re-anchoring it would quietly overwrite what the host chose.
 * - **Only once.** The caller stores `uploadWindowAnchoredAt` in the same write
 *   under a condition, so two uploads racing to be the fifth cannot both win.
 * - **Only forward.** A window is a thing somebody paid for; this may extend it
 *   and may never shorten it.
 * - **Only an event that has a window.** Events predating the lifecycle model
 *   carry none, and giving one a deadline it never had would be this function
 *   taking something away rather than giving it.
 */
export function anchoredWindowEnd(
  facts: AnchorFacts,
  now: Date = new Date(),
): string | null {
  if ((facts.eventDate ?? '').trim()) return null;
  if (facts.alreadyAnchored) return null;
  if (facts.photoCountBefore + 1 < ANCHOR_UPLOAD_COUNT) return null;

  const current = Date.parse(facts.currentEndsAt ?? '');
  if (!Number.isFinite(current)) return null;

  const candidate = now.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS;
  return candidate > current ? new Date(candidate).toISOString() : null;
}
