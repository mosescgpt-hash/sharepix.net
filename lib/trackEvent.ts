import { isAnalyticsEvent, type AnalyticsEventName } from '@/lib/analytics';
import {
  browserExcluded,
  excludeThisBrowser,
  shouldCount,
  type Viewer,
} from '@/lib/analyticsAudience';
import { isGlobalAdmin } from '@/lib/admin';
import { authModeFor, getClient } from '@/lib/dataClient';

/**
 * Funnel tracking, on its own.
 *
 * The homepage imported exactly one symbol from `lib/api.ts` — this one — and
 * received all 3,200 lines of it, because a bundler splits by module rather
 * than by function. So `/` shipped the photo upload path, the download path and
 * the print checkout in order to show marketing copy to a logged-out stranger.
 * Moving this one function took 30 KB gzipped off that page.
 *
 * Splitting the rest of `api.ts` was considered and not done: it is 37
 * importers of change for a benefit nobody had measured, where this was one
 * file for a benefit that was measured first. See `lib/dataClient.ts` for why
 * sharing the client does not quietly reconnect the two.
 */

let viewerPromise: Promise<Viewer> | null = null;

/**
 * Who is looking, for the purpose of deciding whether to count them.
 *
 * Resolved once per page load and remembered: the same answer for every event
 * fired afterwards, and one auth round-trip rather than one per click.
 */
function viewerForAnalytics(): Promise<Viewer> {
  if (!viewerPromise) {
    viewerPromise = (async (): Promise<Viewer> => {
      const excluded = browserExcluded();
      let admin: boolean | null = null;
      try {
        admin = await isGlobalAdmin();
      } catch {
        // Signed out throws here, which is the common case and not an error.
        // Null means "could not tell", which counts. See lib/analyticsAudience.
        admin = null;
      }
      // Recognised once, remembered after: most operator visits to the
      // marketing site are from a logged-out tab, which the group check alone
      // would never catch.
      if (admin === true && !excluded) excludeThisBrowser();
      return { isAdmin: admin, browserExcluded: excluded };
    })();
  }
  return viewerPromise;
}

/**
 * Record one funnel event. Fire-and-forget, and silent on failure — a funnel is
 * not worth a broken page.
 */
export function trackEvent(
  name: AnalyticsEventName,
  scopeId = 'anon',
  detail?: Record<string, unknown>,
): void {
  if (!isAnalyticsEvent(name)) return;
  void (async () => {
    try {
      if (!shouldCount(await viewerForAnalytics())) return;
      await getClient().mutations.recordAnalyticsEvent(
        {
          name,
          scopeId,
          detailJson: detail ? JSON.stringify(detail).slice(0, 500) : undefined,
        },
        { authMode: await authModeFor() },
      );
    } catch {
      // Never surfaced. A funnel is not worth a broken page.
    }
  })();
}
