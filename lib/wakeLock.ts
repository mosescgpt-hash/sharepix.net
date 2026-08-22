/**
 * Keep a phone's screen awake while something long is running (an upload).
 *
 * This does NOT let a page work in the background — the OS still suspends a
 * backgrounded or locked tab, and no web API changes that. What it fixes is the
 * common case: the screen auto-locks after 30 seconds mid-upload and the upload
 * dies. With a wake lock held, the screen stays on while the page is open, so a
 * guest doesn't have to keep tapping it.
 *
 * Supported on Android Chrome and iOS Safari 16.4+. On anything older the
 * controller is a no-op, so callers never have to branch.
 */

// Minimal shapes, so this compiles without relying on the DOM lib including the
// Wake Lock types (they're recent).
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return api ?? null;
}

export function isWakeLockSupported(): boolean {
  return wakeLockApi() !== null;
}

export interface ScreenWakeLock {
  /** Release the lock and stop re-acquiring it. Safe to call more than once. */
  release(): Promise<void>;
}

/**
 * Acquire a screen wake lock. Always resolves to a controller — a no-op one when
 * the API is missing or the request is denied (e.g. low battery), so the caller
 * just holds it and releases it in a `finally`.
 *
 * `api` is injectable so tests pass a fake instead of mutating a global
 * `navigator` — which doesn't exist in the Node test environment at all.
 */
export async function keepScreenAwake(
  api: WakeLockLike | null = wakeLockApi(),
): Promise<ScreenWakeLock> {
  if (!api) return { release: async () => {} };

  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const acquire = async () => {
    if (released || sentinel) return;
    try {
      sentinel = await api.request('screen');
    } catch {
      sentinel = null; // denied — nothing to do; the upload still runs
    }
  };

  // The OS drops the lock whenever the page is hidden. If the guest flips away
  // and back during an upload, re-acquire so the screen stays awake again.
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void acquire();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  await acquire();

  return {
    async release() {
      released = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      try {
        await sentinel?.release();
      } catch {
        // Already gone (page hidden, etc.) — nothing to do.
      }
      sentinel = null;
    },
  };
}
