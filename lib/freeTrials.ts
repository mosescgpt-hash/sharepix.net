import { isTrialTier } from './pricing';
import type { QREvent } from './types';

/**
 * The free trial events, newest first, for the admin Free trials tab.
 *
 * "Trial" is the pricing capability flag, not a tier id, so the retired
 * original free tier is included and a future trial tier will be too.
 */
export function freeTrialEvents(events: readonly QREvent[]): QREvent[] {
  return events
    .filter((event) => isTrialTier(event.tier))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** How many of them were created in the last `days` days. */
export function countCreatedWithin(
  events: readonly QREvent[],
  days: number,
  now: Date = new Date(),
): number {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  return events.filter((event) => {
    const at = event.createdAt ? Date.parse(event.createdAt) : NaN;
    return Number.isFinite(at) && at >= since;
  }).length;
}
