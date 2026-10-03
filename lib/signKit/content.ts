/**
 * What goes on the signs for one event, and the links they carry.
 *
 * The QR and the NFC tag must open the same guest page, so both come from
 * eventUploadUrl — the same `/event/<id>/upload` link the table tent and the
 * dashboard QR already encode.
 */
import { invitesUploads, parseAudience, signHeadline } from '../eventAudience';
import { formatEventCode } from '../eventCodeFormat';
import type { QREvent } from '../types';
import type { SignContent } from './layout';
import { pdfSafeText } from './text';

export const SIGN_INSTRUCTION = 'Scan to share your photos';

export function eventUploadUrl(origin: string, eventId: string): string {
  return `${origin.replace(/\/+$/, '')}/event/${eventId}/upload`;
}

/** "sharepix.net/join" — short enough to type, so no scheme and no www. */
export function joinUrlFor(host: string): string {
  return `${host.replace(/^www\./, '')}/join`;
}

/** When uploads close, for the thank-you insert. Null if unknown or already past. */
export function closesLine(
  event: Pick<QREvent, 'uploadWindowEndsAt' | 'uploadsClosed'>,
  now: number = Date.now(),
): string | null {
  if (event.uploadsClosed) return null;
  const at = event.uploadWindowEndsAt ? Date.parse(event.uploadWindowEndsAt) : NaN;
  if (!Number.isFinite(at) || at <= now) return null;
  const date = new Date(at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `Uploads stay open until ${date}`;
}

export function signContent(
  event: Pick<QREvent, 'id' | 'name' | 'eventCode' | 'uploadAudience' | 'uploadWindowEndsAt' | 'uploadsClosed'>,
  origin: string,
  host: string,
  now: number = Date.now(),
): SignContent {
  const audience = parseAudience(event.uploadAudience);
  return {
    eventName: pdfSafeText(event.name) || 'Our event',
    // A host who said they alone would upload gets the wording the rest of
    // their printables already use; see lib/eventAudience.ts.
    instruction: invitesUploads(audience) ? SIGN_INSTRUCTION : signHeadline(audience),
    uploadUrl: eventUploadUrl(origin, event.id),
    joinUrl: joinUrlFor(host),
    eventCode: pdfSafeText(formatEventCode(event.eventCode)),
    closesLine: closesLine(event, now),
  };
}
