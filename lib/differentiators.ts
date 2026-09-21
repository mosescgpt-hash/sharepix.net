/**
 * The standards SharePix holds itself to — and, for each one, the code that has
 * to keep being true for it.
 *
 * ## Nothing here is about anybody else
 *
 * Deliberately. An earlier draft of this module carried a two-column
 * "the usual way / with SharePix" comparison, and it was removed on purpose:
 * SharePix does not want to be the company whose homepage is about how the
 * other options are bad. Every line below states what SharePix does, in terms
 * that make sense with no rival in the room.
 *
 * That is also the stronger argument. A specific, checkable commitment needs no
 * foil to land, and a reader comparing options can do the comparing themselves.
 *
 * `__tests__/differentiators.test.ts` fails if comparative or disparaging
 * framing appears here or on the page, so this is a rule the repository keeps
 * rather than a preference somebody has to remember.
 *
 * ## Why claims live in a module instead of in JSX
 *
 * Specific commitments carry a hazard: one that stops being true is worse than
 * a vague one, because somebody bought on the strength of it.
 *
 * This repository already has a documented history of that failure — the README
 * carries a section about claims that were accurate when written and quietly
 * stopped being so. Those were internal notes. These are sales promises about
 * privacy, which is a worse place for it.
 *
 * So every claim below names the module that implements it, and
 * `__tests__/differentiators.test.ts` asserts that module still does the thing.
 * Remove the EXIF stripping and the homepage stops building. That is the only
 * mechanism that has ever worked here.
 *
 * ## Why the boundaries are written down
 *
 * Each claim carries a `boundary`: the case where it does not hold. Photo
 * metadata is stripped; **video metadata is not**. A page that said "automatic
 * GPS scrubbing" without qualification would be making a safety promise the
 * product does not keep for video, and the whole point of the claim is that
 * somebody's home address does not travel with a file.
 *
 * Saying so costs a line of copy and is the difference between a claim and a
 * liability.
 */

export interface Differentiator {
  id: string;
  /** Short enough for a card heading. */
  title: string;
  /** The claim, in the customer's language. Must be literally true. */
  claim: string;
  /**
   * Where it does not hold, or '' when there is no meaningful exception.
   *
   * Shown in smaller type next to the claim. Not a disclaimer to bury — a
   * specific limit stated plainly is what makes the rest credible.
   */
  boundary: string;
  /** The file that implements it. What the test checks. */
  backedBy: string;
  /** Short badge for the card. */
  badge: string;
}

export const DIFFERENTIATORS: readonly Differentiator[] = [
  {
    id: 'no-account',
    title: 'Guests never make an account',
    claim:
      'No app, no sign-up, no phone number, no email. A guest scans the code and the upload page opens in the browser they already have.',
    boundary:
      'Hosts sign in, because somebody has to own the event. Guests never do.',
    backedBy: 'amplify/data/resource.ts',
    badge: 'Zero onboarding',
  },
  {
    id: 'location-stripped',
    title: 'Nothing arrives with its location attached',
    claim:
      'A phone stamps the exact coordinates into every photo and video it takes. SharePix removes that on upload, before the file is stored or shared — so a guest is not handing out the address of the house they are standing in.',
    boundary:
      'A photo loses all of its metadata; a video loses its coordinates and keeps the rest, such as the camera model and the time, because removing those would mean re-encoding the file.',
    backedBy: 'amplify/functions/sanitize-upload/video.ts',
    badge: 'GPS removed',
  },
  {
    id: 'full-resolution',
    title: 'The file the camera wrote',
    claim:
      'What a guest uploads is what you download. The bytes are stored exactly as sent and handed back the same way, at the resolution the camera recorded.',
    boundary:
      'SharePix Pro is the deliberate exception: a photographer’s originals are never served to guests, who see a reduced preview instead.',
    backedBy: 'amplify/functions/sanitize-upload/handler.ts',
    badge: 'Original quality',
  },
  {
    id: 'screened-free',
    title: 'Screening on every plan',
    claim:
      'Every still image is checked for explicit content before it can appear anywhere, on every plan including the free one. A flagged photo is held straight away rather than shown while you catch it.',
    boundary:
      'Stills only; video is not screened. Screening is deliberately narrow — it looks for explicit content, not for unflattering photos.',
    backedBy: 'amplify/functions/create-event-photo/moderation.ts',
    badge: 'Every plan',
  },
  {
    id: 'unlisted',
    title: 'Not on the public web',
    claim:
      'Galleries are unlisted and served through short-lived signed links. Search engines are told not to index them, and the robots file refuses the paths outright.',
    boundary:
      'Anyone with the link can look. That is what makes it shareable — treat the link like a key.',
    backedBy: 'lib/seo.ts',
    badge: 'Unlisted',
  },
  {
    id: 'one-payment',
    title: 'One event, one payment',
    claim:
      'Event plans are charged once, at the price on the pricing page. Nothing renews and no card is kept on file afterwards.',
    boundary:
      'The Corporate plan is a monthly subscription, for organisations running events all year. It is the only recurring charge SharePix has.',
    backedBy: 'lib/pricing.ts',
    badge: 'No renewals',
  },
] as const;

/**
 * Words that would turn a commitment into a swipe.
 *
 * The rule is a product decision, not a style preference: SharePix is not going
 * to be the company whose homepage is about how everyone else is worse. A page
 * written that way tells a reader where to go and look next, and it ages badly
 * the moment a rival fixes the thing.
 *
 * Checked against this module and against the rendered copy on the homepage, so
 * the decision survives the next person who is in a hurry.
 */
export const COMPARATIVE_PHRASES: readonly string[] = [
  'unlike',
  'other apps',
  'competitor',
  'rivals',
  'the usual way',
  'most apps',
  'other platforms',
  'unlike them',
  'they make you',
  'nickel',
  'sneaky',
];

export function differentiatorFor(id: string): Differentiator | undefined {
  return DIFFERENTIATORS.find((item) => item.id === id);
}
