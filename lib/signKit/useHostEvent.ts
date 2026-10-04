import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { fetchEvent, getCurrentUserInfo } from '@/lib/api';
import { isGlobalAdmin } from '@/lib/admin';
import type { QREvent } from '@/lib/types';

/**
 * The event for a host-only sign kit page, or why it can't be shown.
 *
 * The same check the table tent makes: the page carries the event's upload
 * link, so only the event's owner or a global admin gets past it. The page is
 * also wrapped in withHostAuth, so a signed-out visitor never reaches this.
 */
export function useHostEvent() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;
  const [event, setEvent] = useState<QREvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const [ev, user, admin] = await Promise.all([
        fetchEvent(eventId),
        getCurrentUserInfo(),
        isGlobalAdmin().catch(() => false),
      ]);
      if (!ev) {
        setError('We couldn’t find that event.');
        return;
      }
      const isOwner = !!user && !!ev.owner && ev.owner.includes(user.userId);
      if (!isOwner && !admin) {
        setDenied(true);
        return;
      }
      setEvent(ev);
    } catch {
      setError('Something went wrong loading your event. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  return { eventId, event, loading, denied, error };
}
