/**
 * Whether an event's upload window has closed.
 *
 * Its own module, beside the handler rather than inside it, for the same reason
 * `access.ts` is: a guest is unauthenticated, so the browser's copy of this
 * rule is a courtesy and this file is the fence. Testing the fence means being
 * able to import it without an AWS client coming along.
 *
 * The window used to be enforced only in the guest UI, which means it was not
 * enforced at all — and the window is precisely the thing an upload-window
 * extension is sold to move, so a request that skipped the page got the
 * extension for free. It is also not the same boundary as `accessExpiresAt`:
 * the gallery deliberately outlives the window by twelve months, so gating
 * uploads on gallery access would leave uploads open for a year.
 */

/**
 * True when uploads should be refused because the window has passed.
 *
 * Absent, empty or unparseable input answers FALSE — uploads stay open.
 * Events created before the lifecycle model carry no window at all, and the
 * failure worth avoiding is turning away a real guest at a real party over a
 * missing field. A window that cannot be read is not a window that has closed.
 */
export function uploadWindowClosed(
  windowEndsAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!windowEndsAt) return false;
  const closesAt = Date.parse(windowEndsAt);
  if (!Number.isFinite(closesAt)) return false;
  return now >= closesAt;
}

/** What a guest is told. Deliberately says nothing about how to reopen it. */
export const UPLOAD_WINDOW_CLOSED_MESSAGE =
  'The upload window for this event has closed.';
