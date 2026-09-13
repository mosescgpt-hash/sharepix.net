/**
 * Whose visits the funnel counts, and whose it does not.
 *
 * The operator of SharePix visits SharePix constantly — checking a deploy,
 * reproducing a bug report, clicking through pricing to see whether the copy
 * change landed. Every one of those was being recorded as a `homepage_view` or
 * a `pricing_view` next to a real prospect's, and at the traffic SharePix has
 * today that is not a rounding error: it is most of the funnel.
 *
 * ## Two rules, and why the second one exists
 *
 * 1. **A signed-in admin is not counted.** The obvious rule, and the one that
 *    covers most of it.
 *
 * 2. **A browser that has ever been recognised as an admin's stops counting,
 *    signed in or not.** Most operator visits are not signed in — a logged-out
 *    tab checking the marketing site is the single most common way to look at
 *    your own homepage, and rule 1 alone would miss every one of them.
 *
 * Rule 2 is a per-browser flag, so it is undone by clearing site data, and
 * `stopExcludingThisBrowser()` exists to undo it deliberately. It can in
 * principle silence a real visitor — someone who signed in as an admin on a
 * shared machine — which is a trade worth making at this scale and worth
 * revisiting if SharePix ever has staff.
 *
 * ## Which way to fail
 *
 * Toward counting. When the admin check throws, or the session is still
 * loading, or storage is unavailable, the visit is recorded. An
 * over-count of a handful of the operator's own page views is a small,
 * self-correcting error; an under-count caused by a check that quietly failed
 * open the other way would make the funnel look dead and be invisible while
 * doing it.
 *
 * ## What this does NOT touch
 *
 * Server-written events. `purchase_completed`, `event_created` and the
 * milestones are facts about rows in the database, and an event the operator
 * created is a real event that really exists — suppressing it would make the
 * funnel disagree with the events table. Those are filtered, if ever, by
 * looking at whose account they belong to, not here.
 */

/** Where the per-browser flag lives. */
export const EXCLUDE_KEY = 'spx.analytics.exclude';

/** What we write. Any non-empty value counts as set; this is what we set. */
const EXCLUDE_VALUE = '1';

export interface Viewer {
  /**
   * Whether this viewer is in the ADMINS group. `null` means the check has not
   * finished or could not be made — treated as "not an admin", per the header.
   */
  isAdmin: boolean | null;
  /** Whether this browser was previously recognised as an admin's. */
  browserExcluded: boolean;
}

/**
 * Should this visit be recorded?
 *
 * Pure, so the rule can be tested without a browser or a Cognito session.
 */
export function shouldCount(viewer: Viewer): boolean {
  if (viewer.isAdmin === true) return false;
  if (viewer.browserExcluded) return false;
  return true;
}

/** Why a visit was skipped. Null when it was counted. For the debug line. */
export function skipReason(viewer: Viewer): 'signed-in-admin' | 'known-browser' | null {
  if (viewer.isAdmin === true) return 'signed-in-admin';
  if (viewer.browserExcluded) return 'known-browser';
  return null;
}

/**
 * Read the per-browser flag.
 *
 * Every storage access here is wrapped: Safari in private mode throws on
 * `localStorage` rather than returning null, and a funnel helper must never be
 * the thing that breaks a page.
 */
export function browserExcluded(): boolean {
  try {
    return window.localStorage.getItem(EXCLUDE_KEY) === EXCLUDE_VALUE;
  } catch {
    return false;
  }
}

/** Remember that this browser is an admin's. Called once, on recognition. */
export function excludeThisBrowser(): void {
  try {
    window.localStorage.setItem(EXCLUDE_KEY, EXCLUDE_VALUE);
  } catch {
    // Then rule 1 still applies whenever they are signed in. Degraded, not
    // broken, and not worth telling anybody about.
  }
}

/**
 * Undo it.
 *
 * Exists so the answer to "why is my traffic zero" is a one-liner in the
 * console rather than clearing all site data:
 *
 *     localStorage.removeItem('spx.analytics.exclude')
 */
export function stopExcludingThisBrowser(): void {
  try {
    window.localStorage.removeItem(EXCLUDE_KEY);
  } catch {
    // Nothing to undo if storage was never readable in the first place.
  }
}
