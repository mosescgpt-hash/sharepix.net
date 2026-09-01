/**
 * Which URL to show a photo or video from, and what to do when it fails.
 *
 * Gallery media is served from Cloudflare R2 where egress is free, and from S3
 * where it isn't in R2. There are several ordinary reasons a given object won't
 * be: nothing was backfilled, so anything uploaded before the mirror went live
 * is S3-only; the mirror is best-effort and may have skipped a newer file; and
 * R2 may not be configured at all.
 *
 * Rather than have the server check each object exists — a network round trip
 * per photo, which is exactly the thing that doesn't scale to a gallery — both
 * URLs are computed up front (signing is local either way, no request to
 * anyone) and the browser falls back when the first one doesn't load. A missing
 * object costs one 404 and no bytes.
 *
 * Pure so the "never loop" property can be tested: an `onError` handler that
 * keeps setting a src that keeps failing spins forever.
 */

export interface MediaSource {
  /** Where to load from first — R2 when it can serve this object. */
  primary: string;
  /** Where to go when the primary fails. S3, normally. */
  fallback?: string | null;
}

/**
 * The first URL to try. Falls straight to the fallback when there is no
 * primary, so a caller never has to special-case "R2 had nothing for this one".
 */
export function initialSource(source: MediaSource): string {
  return source.primary || source.fallback || '';
}

/**
 * What to load after `current` failed, or null when there is nothing left.
 *
 * Null is the signal to stop. Returning the fallback again — or the primary —
 * would make an `onError` handler retry a URL that has already failed, and the
 * browser would fire `onError` again immediately: a tight loop that pins a CPU
 * and floods the network for as long as the page is open.
 */
export function sourceAfterError(current: string, source: MediaSource): string | null {
  const fallback = source.fallback ?? '';
  if (!fallback) return null;
  // Already on the fallback, or the two are the same URL: nothing else to try.
  if (current === fallback) return null;
  if (current !== source.primary) return null;
  return fallback;
}
