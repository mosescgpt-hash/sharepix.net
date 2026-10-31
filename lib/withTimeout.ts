/**
 * Give up waiting on a promise that may never settle.
 *
 * Browsers have no default timeout on a stalled mobile connection, and a few of
 * the calls a page makes first (refreshing the sign-in session, asking Cognito
 * for a guest identity) are plain network requests. When one hangs, the page
 * sits on its "Loading…" text forever with nothing for the person to tap.
 *
 * This does not cancel the underlying work; it only stops the page waiting for
 * it. Relative-import friendly so the Jest node project can use it.
 */
export class TimeoutError extends Error {
  constructor(message = 'Timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof TimeoutError || (error instanceof Error && error.name === 'TimeoutError');
}

/** Reject with a TimeoutError if `promise` has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Resolve to `fallback` instead of rejecting, for checks that must never block a page. */
export function withTimeoutOr<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return withTimeout(promise, ms).catch(() => fallback);
}
