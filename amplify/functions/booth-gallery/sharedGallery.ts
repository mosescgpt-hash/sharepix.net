/**
 * The link from a guest's private booth page to the event's shared gallery,
 * following the host's gallery setting (list-event-photos/visibility.ts):
 *   everyone (or unset): a link;
 *   own: a link, saying guests there see only what they added themselves;
 *   host: no link, a plain note that the host keeps it private;
 *   guests' viewing switched off: the same as host;
 *   sharing paused: no link, a note that the host paused it for now;
 *   QR code replaced (a guest link key is in force): a link and a note that
 *     the gallery needs the host's current QR code or link. The key is never
 *     put on this page — a person's private booth page is forwarded as easily
 *     as any link, and the key is the host's to hand out;
 *   closed event: neither.
 * Pure, so it is unit tested. The gallery page itself still enforces access.
 */
export function sharedGalleryFor(input: {
  eventId: string;
  audience: string | null;
  takenDown: boolean;
  /** The host turned guest viewing off. */
  viewBlocked?: boolean;
  /** The host paused sharing. */
  paused?: boolean;
  /** The host replaced the QR code, so the gallery link needs its current key. */
  linkRequired?: boolean;
}): { sharedGalleryPath: string | null; sharedGalleryMessage: string | null } {
  if (input.takenDown) return { sharedGalleryPath: null, sharedGalleryMessage: null };
  const path = `/event/${encodeURIComponent(input.eventId)}`;
  if (input.paused === true) {
    return { sharedGalleryPath: null, sharedGalleryMessage: 'The host has paused sharing for now.' };
  }
  if (input.audience === 'host' || input.viewBlocked === true) {
    return { sharedGalleryPath: null, sharedGalleryMessage: 'The host keeps this event’s gallery private.' };
  }
  const keyNote =
    input.linkRequired === true ? ' Open it from the host’s current QR code or link.' : '';
  if (input.audience === 'own') {
    return {
      sharedGalleryPath: path,
      sharedGalleryMessage: `In this event’s gallery, guests see only the photos they added there.${keyNote}`,
    };
  }
  return { sharedGalleryPath: path, sharedGalleryMessage: keyNote ? keyNote.trim() : null };
}
