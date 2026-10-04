import { useEffect, useState } from 'react';
import { fetchEventChallenges, type EventChallenge } from './api';

/**
 * An event's challenges, or [] — and no request at all while the event's
 * switch is off, so a page with challenges off behaves exactly as before.
 */
export function useEventChallenges(
  event: { id: string; challengesEnabled?: boolean | null } | null,
): EventChallenge[] {
  const [challenges, setChallenges] = useState<EventChallenge[]>([]);
  const eventId = event?.id ?? null;
  const enabled = event?.challengesEnabled === true;
  useEffect(() => {
    if (!eventId || !enabled) {
      setChallenges([]);
      return;
    }
    let cancelled = false;
    fetchEventChallenges(eventId).then((list) => {
      if (!cancelled) setChallenges(list);
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, enabled]);
  return challenges;
}
