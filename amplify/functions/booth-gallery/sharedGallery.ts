/**
 * The link from a guest's private booth page to the event's shared gallery,
 * following the host's gallery setting (list-event-photos/visibility.ts):
 *   everyone (or unset): a link;
 *   own: a link, saying guests there see only what they added themselves;
 *   host: no link, a plain note that the host keeps it private;
 *   closed event: neither.
 * Pure, so it is unit tested. The gallery page itself still enforces access.
 */
export function sharedGalleryFor(input: {
  eventId: string;
  audience: string | null;
  takenDown: boolean;
}): { sharedGalleryPath: string | null; sharedGalleryMessage: string | null } {
  if (input.takenDown) return { sharedGalleryPath: null, sharedGalleryMessage: null };
  const path = `/event/${encodeURIComponent(input.eventId)}`;
  if (input.audience === 'host') {
    return { sharedGalleryPath: null, sharedGalleryMessage: 'The host keeps this event’s gallery private.' };
  }
  if (input.audience === 'own') {
    return {
      sharedGalleryPath: path,
      sharedGalleryMessage: 'In this event’s gallery, guests see only the photos they added there.',
    };
  }
  return { sharedGalleryPath: path, sharedGalleryMessage: null };
}
