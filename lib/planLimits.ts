/**
 * What an event that ALREADY EXISTS is entitled to today.
 *
 * ## The bug this exists to fix
 *
 * An event stamps its plan's limits onto its own row at creation. That is
 * deliberate and it is the right default: it means a later pricing change can
 * never retroactively take away what somebody already paid for.
 *
 * It has one failure mode, and we shipped it. When the $79 plan went from
 * 3,000 photos to unlimited, the tier table changed and every row created
 * before that change kept `photoLimit: 3000`. Uploads are enforced against the
 * ROW, so a host who bought the plan last month was still hard-capped at 3,000
 * while the pricing page told them, truthfully as far as the code was
 * concerned, that their plan had no limit. Stamping protects a host from a
 * downgrade; on its own it also withholds an upgrade.
 *
 * ## The rule, stated once
 *
 * A stamped limit is a FLOOR, not a ceiling. An event gets the more generous of
 * what it was sold and what its plan includes today. This function can only
 * ever raise a limit or leave it alone — there is no input that makes an event
 * able to hold fewer photos than it could yesterday. That property is the whole
 * reason this is a pure function with its own tests rather than a line inside
 * the upload handler.
 *
 * Two cases deliberately change nothing:
 *
 * - **An unknown tier.** A row carrying a tier string we do not recognise gets
 *   its stored value back unchanged. Guessing an entitlement from a name we
 *   cannot resolve is how a typo becomes unlimited storage.
 * - **A stored limit that is absent or unreadable.** Already treated as
 *   unlimited everywhere else in the codebase (see the comments in
 *   create-event-photo about events created before video limits existed), so it
 *   keeps meaning that here. This is the one direction that is generous rather
 *   than strict, and it is pre-existing behaviour rather than a new decision.
 *
 * ## Why the tables are duplicated
 *
 * `lib/pricing.ts` is the source of truth and this module does not import it,
 * because an Amplify function cannot import from `lib/` and this module is
 * hand-copied into `create-event-photo/`. The copies are drift-tested against
 * `ALL_TIERS` in `__tests__/plan-limits.test.ts`, which fails if a tier's limit
 * changes in pricing and not here.
 */

/**
 * Photo limits as the plans stand TODAY. `null` is unlimited; a tier absent
 * from this table is unknown and entitles an event to nothing new.
 *
 * `corporate` has no PricingTier row — it is a subscription, not a per-event
 * plan — so it is listed explicitly rather than falling through to "unknown".
 */
export const CURRENT_PHOTO_LIMITS: Record<string, number | null> = {
  free: 50,
  plus: null,
  event: 1000,
  starter: 100,
  standard: 1000,
  premium: null,
  corporate: null,
};

/**
 * Video limits as the plans stand today.
 *
 * Every value here currently equals what was stamped, so this table raises
 * nothing — it exists so that the next time a video allowance moves, it moves
 * for the events that already exist too, instead of being noticed months later
 * the way the photo cap was.
 */
export const CURRENT_VIDEO_LIMITS: Record<string, number | null> = {
  free: 1,
  plus: 30,
  event: 10,
  starter: 2,
  standard: 10,
  premium: 30,
  corporate: 30,
};

/** The parts of an event row that decide what it may hold. */
export interface PlanRow {
  tier?: string | null;
  photoLimit?: number | null;
  videoLimit?: number | null;
}

/** A stored limit, or null when it is absent or unreadable (= unlimited). */
function storedLimit(value: number | null | undefined): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * The more generous of what was sold and what the plan includes today.
 *
 * Never returns a number smaller than `stored`. Returning `null` from a numeric
 * `stored` only ever happens when the plan is unlimited today, which is a
 * raise.
 */
function entitled(stored: number | null | undefined, current: number | null | undefined): number | null {
  const floor = storedLimit(stored);
  if (floor === null) return null; // already unlimited
  if (current === undefined) return floor; // unknown tier: change nothing
  if (current === null) return null; // the plan is unlimited today
  if (typeof current !== 'number' || !Number.isFinite(current) || current < 0) return floor;
  return Math.max(floor, current);
}

/** Photos this event may hold today. `null` is unlimited. */
export function entitledPhotoLimit(row: PlanRow | null | undefined): number | null {
  if (!row) return null;
  return entitled(row.photoLimit, CURRENT_PHOTO_LIMITS[(row.tier ?? '').toLowerCase()]);
}

/** Videos this event may hold today. `null` is unlimited. */
export function entitledVideoLimit(row: PlanRow | null | undefined): number | null {
  if (!row) return null;
  return entitled(row.videoLimit, CURRENT_VIDEO_LIMITS[(row.tier ?? '').toLowerCase()]);
}

/**
 * Whether this row's stored limits understate what the event is entitled to.
 *
 * For the admin screen, and for deciding whether a backfill has anything left
 * to do. A row that reads 3,000 on a plan that is now unlimited is not broken —
 * uploads already go by the entitlement — but it is stale, and an operator
 * looking at a storage list should be able to tell the difference.
 */
export function limitsAreStale(row: PlanRow | null | undefined): boolean {
  if (!row) return false;
  const photo = entitledPhotoLimit(row);
  const video = entitledVideoLimit(row);
  return photo !== storedLimit(row.photoLimit) || video !== storedLimit(row.videoLimit);
}
