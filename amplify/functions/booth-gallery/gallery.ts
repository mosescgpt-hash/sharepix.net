/**
 * The pure rules of a booth attendee's private gallery, tested directly.
 */

/** A gallery key as booth-signup issues them (24 random bytes, base64url). */
export function isGalleryKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(key);
}

/** How long the signed links last. Long enough to download a few dozen originals. */
export const LINK_TTL_SECONDS = 60 * 60;

/** The most photos one gallery returns; a person at a booth, not an event. */
export const MAX_GALLERY_PHOTOS = 300;

/**
 * Whether a photo belongs in this person's gallery: it goes to them, and the
 * photographer approved it. Nothing unapproved is ever shown — the plan's
 * promise is that the photographer decides what each person receives.
 */
export function inGallery(
  photo: { recipients: readonly string[]; publishStatus: string | null },
  attendeeId: string,
): boolean {
  return photo.publishStatus === 'approved' && photo.recipients.includes(attendeeId);
}

/** A download filename: the event name, made safe, and a number. */
export function downloadName(eventName: string, index: number, contentType: string | null): string {
  const base =
    eventName
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'photo';
  const ext = contentType === 'image/heic' ? 'heic' : contentType === 'image/png' ? 'png' : 'jpg';
  return `${base}-${String(index + 1).padStart(3, '0')}.${ext}`;
}
