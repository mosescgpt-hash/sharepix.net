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
 * Each claim carries a `boundary`: the case where it does not hold. Location is
 * removed from photos *and* video, but not equally — a JPEG loses all of its
 * metadata, while a video loses its coordinates and keeps the camera model and
 * the time, because taking more out would mean rebuilding the file.
 *
 * That distinction is exactly the sort a marketing page rounds off. It should
 * not be: the boundary is what a reader can check, and the unqualified version
 * of a safety claim is the one that becomes a liability.
 *
 * This header previously read "video metadata is **not** stripped", which was
 * true when written and stopped being true the day the video path shipped —
 * which is the failure the whole module exists to guard against, appearing in
 * the module's own documentation.
 */

export interface Differentiator {
  id: string;
  /** Short enough for a card heading. */
  title: string;
  /** The claim, in the customer's language. Must be literally true. */
  claim: string;
  /** A one-line version of the claim, for the homepage cards. Same meaning, fewer words. */
  short?: string;
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
      'Guests just scan the code with their phone camera and start sharing, with no app to download and no sign-up.',
    boundary:
      'You, the host, sign in to run the event. Your guests never have to.',
    short: 'Guests scan the code and start sharing. No app to download, no sign-up.',
    backedBy: 'amplify/data/resource.ts',
    badge: 'No sign-up',
  },
  {
    id: 'location-stripped',
    title: 'Your guests\u2019 locations stay private',
    claim:
      'We remove the hidden location from every photo and video when it is uploaded, so nobody can tell where it was taken.',
    boundary:
      'Photos lose all hidden details. A video keeps the rest, like the time and phone model, but its location is still removed.',
    short: 'We remove the hidden location from every photo and video when it is uploaded.',
    backedBy: 'amplify/functions/sanitize-upload/video.ts',
    badge: 'Location removed',
  },
  {
    id: 'full-resolution',
    title: 'Full quality, never shrunk',
    claim:
      'You get every photo and video at the full resolution the phone took it, never shrunk or blurred.',
    boundary:
      'The gallery shows a lighter copy on screen so it loads quickly. What you download is the full-resolution original.',
    short: 'Every photo and video at the full resolution the phone took it.',
    backedBy: 'amplify/functions/sanitize-upload/handler.ts',
    badge: 'Full quality',
  },
  {
    id: 'audience',
    title: 'You choose who sees it',
    claim:
      'Let guests see everything, let each guest see only what they added, or keep every photo to yourself.',
    boundary:
      'There is no password on a gallery. If guests can see it, so can anyone you give the link to. You can pause sharing at any time, or replace the QR code so older links stop working.',
    // The setting itself, and the function that applies it.
    short: 'Guests see everything, only what they added, or nothing at all.',
    backedBy: 'amplify/functions/list-event-photos/visibility.ts',
    badge: 'Your call',
  },
  {
    id: 'screened-free',
    title: 'Inappropriate photos are held back',
    claim:
      'Every photo is checked for explicit content before anyone can see it, even on the free plan.',
    boundary:
      'This checks photos, not videos, and only looks for explicit content.',
    backedBy: 'amplify/functions/create-event-photo/moderation.ts',
    badge: 'Every plan',
  },
  {
    id: 'unlisted',
    title: 'Private by default',
    claim:
      'Only people with your link can find your gallery, and it\u2019s set to stay out of Google search.',
    boundary:
      'Anyone you give the link to can look, so share it like you would a house key.',
    backedBy: 'lib/seo.ts',
    badge: 'Link only',
  },
  {
    id: 'one-payment',
    title: 'Pay once per event',
    claim:
      'You pay once for an event, with no subscription and no card kept on file.',
    boundary:
      'The Corporate plan is the one exception: a monthly plan for companies that run events all year.',
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

/**
 * Which of those a piece of copy actually uses.
 *
 * Matched on word boundaries, which is not fussiness: a plain
 * `includes('rivals')` fires on **arrivals**, and the live slideshow copy says
 * "new arrivals jump the queue". A guard that cries wolf on ordinary prose is a
 * guard somebody switches off.
 *
 * A plain boundary at both ends is not enough either. It would miss
 * "competitors", because the trailing `\b` cannot sit between "competitor" and
 * its own plural — so the obvious spelling of this check has a hole exactly
 * where the word is most likely to appear. A trailing `s` or `es` is therefore
 * allowed, and nothing more: "unlikely" must not read as "unlike".
 */
export function comparativePhrasesIn(text: string): string[] {
  const haystack = text.toLowerCase();
  return COMPARATIVE_PHRASES.filter((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}(?:es|s)?\\b`).test(haystack);
  });
}

/**
 * The four promises the homepage shows, in order.
 *
 * The rest of the module stays whole — the pricing page, the help articles and
 * the tests still read every claim — but a homepage that prints all of them is
 * the page nobody reads to the end.
 */
export const HOMEPAGE_PROMISE_IDS = [
  'no-account',
  'location-stripped',
  'full-resolution',
  'audience',
] as const;

export const HOMEPAGE_PROMISES: readonly Differentiator[] = HOMEPAGE_PROMISE_IDS.map((id) => {
  const found = DIFFERENTIATORS.find((item) => item.id === id);
  if (!found) throw new Error(`Homepage promise "${id}" is not in DIFFERENTIATORS`);
  return found;
});

export function differentiatorFor(id: string): Differentiator | undefined {
  return DIFFERENTIATORS.find((item) => item.id === id);
}
