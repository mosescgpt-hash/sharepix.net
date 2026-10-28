import { useEffect, useState } from 'react';
import { manageGalleryLink } from '@/lib/api';
import { getLinkKey } from '@/lib/galleryAccess';

/**
 * The guest link key for an event, for pages that print or show a guest QR code
 * or link. `key` is '' until the host has replaced the QR code once (nothing to
 * add to the links then), and for anyone who is not the host or an admin.
 *
 * `ready` turns true once the answer is known, so a page that prints a sign can
 * wait for it rather than print a code without the key.
 *
 * `hostView` says whether to ask the server. A guest's own tab already holds
 * the key it arrived with, so it never asks.
 */
export function useGuestLinkKey(
  eventId: string | undefined | null,
  hostView: boolean = true,
): { key: string; ready: boolean } {
  const [key, setKey] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    const held = getLinkKey(eventId);
    if (held) setKey(held);
    if (!hostView) {
      setReady(true);
      return;
    }
    setReady(false);
    manageGalleryLink(eventId, 'get')
      .then((result) => {
        if (!cancelled && result.ok && result.linkKey) setKey(result.linkKey);
      })
      .catch(() => {
        // A failed read leaves the links without a key, as they were before.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, hostView]);

  return { key, ready };
}
