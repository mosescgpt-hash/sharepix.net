/**
 * Pure helpers for attaching a photo or video message while signing the guest
 * book. No AWS and no DOM, so they are tested
 * directly and the page stays about layout.
 *
 * Nothing here decides what a guest may do. Limits, screening, the host's video
 * review and the check that an attached photo belongs to the event all stay
 * server-side, in createEventPhoto and signGuestBook.
 */

import { isVideoFilename } from './validation';

/**
 * The line shown with the add buttons. The first sentence is the upload page's
 * own consent text word for word (components/UploadForm.tsx), so a guest is
 * told the same thing wherever they add a file; the second says what is
 * different about the guest book.
 */
export const GUEST_BOOK_CONSENT_LINE =
  'By uploading, you understand these photos and videos will be visible to other event guests. A photo you attach also appears in the guest book.';

/** Added when a video is attached, because the host sees guest videos first. */
export const GUEST_BOOK_VIDEO_CONSENT_LINE =
  'Videos go to the host first. A video appears once the host approves it.';

export type AttachmentKind = 'photo' | 'video';

/** Same rule the upload queue uses to tell a video from a still. */
export function attachmentKind(file: { name: string; type?: string }): AttachmentKind {
  return isVideoFilename(file.name) || (file.type ?? '').toLowerCase().startsWith('video/')
    ? 'video'
    : 'photo';
}

/**
 * Whether a guest's video will wait for the host. Mirrors videoStatusFor on the
 * server: held unless the host chose to allow everything. A hint for wording
 * only; the server holds or releases the video.
 */
export function videoWaitsForHost(moderationMode?: string | null): boolean {
  return (moderationMode ?? 'review') !== 'allow_all';
}

/** What to tell the guest once their note is saved, or null for the default. */
export function postSubmitNotice(input: {
  /** The note itself was held (it contained a link). */
  pending: boolean;
  attached: AttachmentKind | null;
  moderationMode?: string | null;
}): string | null {
  const video = input.attached === 'video' && videoWaitsForHost(input.moderationMode);
  if (input.pending && video) {
    return 'Thank you — your note and video are with the host and will appear once they approve them.';
  }
  if (video) {
    return 'Thank you — your note is in the book. Your video will show once the host approves it.';
  }
  return null;
}

/** Plain wording for a failed attachment upload; the note is never lost. */
export function attachmentFailureMessage(kind: AttachmentKind, detail?: string | null): string {
  const what = kind === 'video' ? 'video' : 'photo';
  const lead = detail?.trim() ? `${detail.trim()} ` : `Your ${what} could not be uploaded. `;
  return `${lead}Your note is still here — tap “Sign the guest book” to try the ${what} again.`;
}

/** Plain wording when the file went up but the note did not save. */
export function noteFailureMessage(kind: AttachmentKind, detail: string): string {
  const what = kind === 'video' ? 'video' : 'photo';
  return `${detail} Your ${what} is already uploaded and will not be sent again — tap “Sign the guest book” to finish.`;
}
