/**
 * The link from a guest's private booth page to the event's shared gallery,
 * following the host's gallery setting (list-event-photos/visibility.ts):
 *   everyone (or unset): a link;
 *   own: a link, saying guests there see only what they added themselves;
 *   host: no link, a plain note that the host keeps it private;
 *   guests' viewing switched off: the same as host;
 *   gallery PIN on: a link and a note that it asks for the PIN. The PIN is
 *     never put on this page — a person's private booth page is forwarded as
 *     easily as any link, and the PIN is the host's to hand out;
 *   closed event: neither.
 * Pure, so it is unit tested. The gallery page itself still enforces access.
 */
export function sharedGalleryFor(input: {
  eventId: string;
  audience: string | null;
  takenDown: boolean;
  /** The host turned guest viewing off. */
  viewBlocked?: boolean;
  /** The gallery PIN is on right now. */
  pinRequired?: boolean;
}): { sharedGalleryPath: string | null; sharedGalleryMessage: string | null } {
  if (input.takenDown) return { sharedGalleryPath: null, sharedGalleryMessage: null };
  const path = `/event/${encodeURIComponent(input.eventId)}`;
  if (input.audience === 'host' || input.viewBlocked === true) {
    return { sharedGalleryPath: null, sharedGalleryMessage: 'The host keeps this event’s gallery private.' };
  }
  const pinNote = input.pinRequired === true ? ' The gallery asks for a PIN; the host can give it to you.' : '';
  if (input.audience === 'own') {
    return {
      sharedGalleryPath: path,
      sharedGalleryMessage: `In this event’s gallery, guests see only the photos they added there.${pinNote}`,
    };
  }
  return { sharedGalleryPath: path, sharedGalleryMessage: pinNote ? pinNote.trim() : null };
}
