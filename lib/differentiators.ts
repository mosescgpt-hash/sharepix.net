/**
 * What SharePix does that a competitor's landing page cannot honestly copy —
 * and, for each claim, the code that has to keep being true for it.
 *
 * ## Why claims live in a module instead of in JSX
 *
 * The market is crowded and every entrant says "QR code, no app, live
 * slideshow". Differentiation therefore has to rest on things that are
 * specifically, checkably true, which creates a new hazard: a specific claim
 * that stops being true is worse than a vague one, because somebody bought on
 * the strength of it.
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
    title: 'Photos arrive without their location',
    claim:
      'A phone stamps the exact coordinates into every photo it takes. SharePix removes that on upload, before the file is stored or shared — so a guest is not handing out the address of the house they are standing in.',
    boundary:
      'Photos only. Video metadata is left exactly as the phone recorded it, including location if the phone wrote it.',
    backedBy: 'amplify/functions/sanitize-upload/exif.ts',
    badge: 'GPS removed',
  },
  {
    id: 'full-resolution',
    title: 'The original file, not a copy of it',
    claim:
      'What a guest uploads is what you download. No resizing, no re-encoding, no quality setting applied on the way through — the bytes are kept as sent.',
    boundary:
      'SharePix Pro is the deliberate exception: a photographer’s originals are never served to guests, who see a reduced preview instead.',
    backedBy: 'amplify/functions/sanitize-upload/handler.ts',
    badge: 'Original quality',
  },
  {
    id: 'screened-free',
    title: 'Screening is not an upsell',
    claim:
      'Every still image is checked for explicit content before it can appear anywhere — on every plan, including the free one. A flagged photo is never briefly visible while you catch it.',
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
      'Event plans are charged once. Nothing renews, no card is kept on file for later, and there is no plan that quietly bills again next month.',
    boundary:
      'The Corporate plan is a monthly subscription, for organisations running events all year. It is the only recurring charge SharePix has.',
    backedBy: 'lib/pricing.ts',
    badge: 'No renewals',
  },
] as const;

/**
 * The comparison table on the homepage.
 *
 * Deliberately not a named-competitor table. Two reasons, and the second is the
 * one that matters:
 *
 * 1. Claims about a named rival have to be verifiable, and nothing in this
 *    repository can check what somebody else's app weighs or requires.
 * 2. A specific, checkable claim standing next to a vague one reads as
 *    confident. A page full of swipes at rivals reads as nervous, and invites
 *    the reader to go and look at them.
 *
 * So the left column is the honest status quo most people are actually coming
 * from — a group chat, a shared drive, or an app-shaped tool — described in
 * terms nobody would dispute. The right column is specific, and every line of
 * it is pinned by a test.
 */
export interface Comparison {
  /** What people do today. No invented statistics, no named products. */
  usual: string;
  /** What SharePix does. Must be backed by a Differentiator. */
  sharepix: string;
  /** Which claim above carries it. */
  differentiatorId: string;
}

export const COMPARISONS: readonly Comparison[] = [
  {
    usual: 'Install an app, or make an account, before you can send a photo',
    sharepix: 'Scan, pick photos, done — in the browser that is already open',
    differentiatorId: 'no-account',
  },
  {
    usual: 'Photos come back squeezed down to whatever the app decided',
    sharepix: 'The original file, at the size the camera wrote it',
    differentiatorId: 'full-resolution',
  },
  {
    usual: 'Every original still carries the GPS coordinates it was taken at',
    sharepix: 'Location data is removed from photos as they arrive',
    differentiatorId: 'location-stripped',
  },
  {
    usual: 'Nothing stands between an unwelcome photo and the projector',
    sharepix: 'Screened automatically first, and you can hold everything for approval',
    differentiatorId: 'screened-free',
  },
  {
    usual: 'Collecting them afterwards means chasing people who have moved on',
    sharepix: 'Already collected, in one gallery, downloadable as a single ZIP',
    differentiatorId: 'full-resolution',
  },
] as const;

export function differentiatorFor(id: string): Differentiator | undefined {
  return DIFFERENTIATORS.find((item) => item.id === id);
}
