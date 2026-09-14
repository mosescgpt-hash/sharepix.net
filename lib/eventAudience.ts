/**
 * Whether guests are expected to upload, and what follows from the answer.
 *
 * ## The event that started this
 *
 * A church shares photos with parents. One person takes the pictures, one
 * person uploads them, and everyone else opens the gallery to look. That is not
 * a SharePix event going wrong — it is exactly what they bought — but every
 * sign SharePix printed for them said **"Scan to add your photos"**, which is
 * an instruction nobody in the room was meant to follow.
 *
 * The refund side of this has already been fixed: SharePix no longer volunteers
 * money to a host whose guests did not upload, because for this host that was
 * never a failure. What was left is the copy, and the copy is the part the
 * guests actually see.
 *
 * ## Why it is a question at setup and not a guess
 *
 * The counts can tell you afterwards that one person uploaded. They cannot tell
 * you whether that was the plan, and the difference decides what the sign
 * should have said before anyone arrived. Only the host knows, and only at the
 * start.
 *
 * ## The wording is deliberately not a judgement
 *
 * Neither answer is the better event, and the question must not imply one is.
 * "Just me" is a legitimate, fully-featured way to use SharePix — most of what
 * a host pays for is the gallery, the printing, the retention and the
 * slideshow, none of which care who pressed upload. A question phrased as
 * "will your guests be participating?" would read as a test the church fails.
 *
 * ## Null means never asked
 *
 * Every event created before this existed has no answer, and there is no honest
 * way to infer one. Those keep the wording they were printed with — the guest
 * default — because a sign already out in the world says what it says, and
 * changing the copy under a host mid-event would mean the card on the table and
 * the page it opens disagree.
 */

/** What a host said at setup. `null` is "we never asked". */
export type UploadAudience = 'guests' | 'host-only' | null;

/** The question, as the host reads it. */
export const AUDIENCE_QUESTION = 'Who will be adding the photos?';

/**
 * Why SharePix is asking, in one line under the question.
 *
 * It says what changes, because a host deciding between two options deserves to
 * know what turns on the answer, and because "we only use this to word the
 * signs" is both true and reassuring — it is not a plan, a limit, or a price.
 */
export const AUDIENCE_HELP =
  'It only changes the wording on your QR signs. You can change it later, and either way everyone can see the gallery.';

export interface AudienceOption {
  value: Exclude<UploadAudience, null>;
  label: string;
  /** The consequence, stated plainly, so neither option reads as the default. */
  detail: string;
}

/**
 * The two answers.
 *
 * "My guests" first because it is the common case, not because it is the right
 * one — and both carry a `detail`, so the second is not the bare alternative to
 * a described option.
 */
export const AUDIENCE_OPTIONS: readonly AudienceOption[] = [
  {
    value: 'guests',
    label: 'My guests and me',
    detail: 'Signs say “Scan to add your photos”.',
  },
  {
    value: 'host-only',
    label: 'Just me',
    detail: 'Signs say “Scan to see the photos”. Guests can still view and download.',
  },
];

/** What the host chose, normalised. Anything unrecognised is "never asked". */
export function parseAudience(value: unknown): UploadAudience {
  return value === 'guests' || value === 'host-only' ? value : null;
}

/**
 * Whether the printed material should invite guests to upload.
 *
 * The default when nobody answered is `true`, matching every sign printed
 * before this existed.
 */
export function invitesUploads(audience: UploadAudience): boolean {
  return audience !== 'host-only';
}

/** The big line on a table tent, a brochure, or the QR card. */
export function signHeadline(audience: UploadAudience): string {
  return invitesUploads(audience) ? 'Scan to add your photos' : 'Scan to see the photos';
}

/** The paragraph under it. */
export function signMessage(audience: UploadAudience): string {
  return invitesUploads(audience)
    ? "Point your phone's camera at the code and upload the pictures you took. No app, no account — everyone's photos land in one gallery."
    : "Point your phone's camera at the code to see the photos from today. No app, no account — and you can save any of them to your phone.";
}

/** The sentence beside the QR code on the dashboard. */
export function qrCaption(audience: UploadAudience, eventName: string): string {
  return invitesUploads(audience)
    ? `Guests scan this code to upload photos and videos to ${eventName}.`
    : `Guests scan this code to see the photos from ${eventName}.`;
}

/**
 * What the refund review should say about a one-uploader event.
 *
 * `lib/eventReview.ts` builds the dossier a person reads before deciding
 * whether a refund is owed. An event with one uploader and `host-only` recorded
 * at setup is not a disappointed customer; an event with one uploader that
 * expected guests might be. Saying which is the whole value of having asked.
 *
 * It is evidence, not a verdict — the word is "said", because this is a claim a
 * host made at setup rather than a fact SharePix observed.
 */
export function reviewNote(audience: UploadAudience): string {
  switch (audience) {
    case 'host-only':
      return 'At setup the host said they would be the only one adding photos.';
    case 'guests':
      return 'At setup the host said their guests would be adding photos.';
    default:
      return 'This event was created before we asked who would be adding photos.';
  }
}
