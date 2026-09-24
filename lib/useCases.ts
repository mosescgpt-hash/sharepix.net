/**
 * Content for the use-case landing pages (/weddings, /graduation-parties,
 * /corporate-events, /conventions).
 *
 * One typed list rather than four page files that each type out their own
 * copy, for the same reason `lib/help.ts` and `lib/differentiators.ts` are
 * modules instead of JSX: the page that renders it and the sitemap/route
 * metadata that describes it both read from here, so the two cannot say
 * different things about the same page.
 *
 * Every fact used below (photo/video limits, the upload window, pricing) is
 * pulled from `lib/pricing.ts` rather than typed as a literal, for the reason
 * `lib/seo.ts` gives for `PAID_TIER_PRICE`: a number typed into copy is a
 * number that keeps saying $79 six months after the price moved.
 */
import type { ImageSlot } from './imagery';
import { CORPORATE_PLAN, PRICING_TIERS, UPLOAD_WINDOW_DAYS } from './pricing';

const FREE_TIER = PRICING_TIERS.find((tier) => tier.price === 0);

/** Photo limit on the free trial, e.g. 50. Falls back if the tier list ever changes shape. */
const FREE_PHOTO_LIMIT = FREE_TIER?.photoLimit ?? 50;

export interface UseCaseFaq {
  question: string;
  answer: string;
}

export interface UseCase {
  /** The route, without a leading slash: 'weddings' → /weddings. */
  slug: string;
  /** Passed to Layout's `title`, which appends " — sharepix.net" itself. */
  metaTitle: string;
  /** Short label for the footer's "Use cases" group — not the same as the headline. */
  navLabel: string;
  /** Shown in the eyebrow above the headline. */
  eyebrow: string;
  /** Headline, split the way every other `Heading` on the site is: bold sans, then italic serif. */
  h1First: string;
  h1Second: string;
  heroBody: string;
  /** The image slot beside the hero copy — see lib/imagery.ts. Renders a
   *  palette placeholder until real photography exists for the slot. */
  heroSlot: ImageSlot;
  /** Two or three slots shown lower on the page, each with its own caption. */
  gallery: { slot: ImageSlot; caption: string }[];
  /** Short, single-line claims — rendered as a grid, not full paragraphs. */
  benefits: string[];
  faqs: UseCaseFaq[];
}

export const USE_CASES: UseCase[] = [
  {
    slug: 'weddings',
    metaTitle: 'Wedding QR Code Photo Sharing — No App for Guests',
    navLabel: 'Weddings',
    eyebrow: 'For weddings',
    h1First: 'Every photo your wedding guests take,',
    h1Second: 'in one place.',
    heroBody:
      'Put one QR code on every table. Guests point a camera at it and start sending photos — no app, no account, nothing to explain. You get the originals, at the size the camera recorded them.',
    heroSlot: 'occasion-wedding',
    gallery: [
      { slot: 'how-it-works-scan', caption: 'Scan the code on the table' },
      { slot: 'guest-book-spread', caption: 'Sign the guest book' },
      { slot: 'live-slideshow', caption: 'Watch it fill up on a screen at the reception' },
    ],
    benefits: [
      'The candids your photographer missed',
      'Grandma can do it: point, scan, share',
      'Live slideshow at the reception',
      'Guest book notes alongside the photos',
    ],
    faqs: [
      {
        question: 'Do guests need to download an app?',
        answer: 'No. They scan the QR code with their phone camera and upload from the browser.',
      },
      {
        question: 'How long can guests upload?',
        answer: `${UPLOAD_WINDOW_DAYS} days on the Full Event, and you can extend it. People keep finding photos for weeks.`,
      },
      {
        question: 'Are the photos full quality?',
        answer: 'Yes. Originals are kept at full resolution, and location data is removed.',
      },
      {
        question: 'Can I remove a photo?',
        answer: 'Yes. You can moderate and delete from your host dashboard.',
      },
      {
        question: 'Does this replace our photographer?',
        answer: 'No. It collects the moments your photographer isn’t there for.',
      },
    ],
  },
  {
    slug: 'graduation-parties',
    metaTitle: 'Graduation Party Photo Sharing with a QR Code',
    navLabel: 'Graduation parties',
    eyebrow: 'For graduation parties',
    h1First: 'One QR code.',
    h1Second: 'Every photo from the grad party.',
    heroBody:
      'Put the code out where people are already taking pictures. Friends, family and neighbors add theirs straight from their phone — no app, no account, and nothing for you to collect afterward.',
    heroSlot: 'occasion-graduation',
    gallery: [
      { slot: 'how-it-works-scan', caption: 'Scan the code, no app to open first' },
      { slot: 'home-gallery-preview', caption: 'Every guest’s photos, one gallery' },
    ],
    benefits: [
      'Works for open houses with people coming and going',
      "Friends' photos and family photos in one gallery",
      'Download everything for the slideshow or scrapbook',
      'Free for smaller parties',
    ],
    faqs: [
      {
        question: 'Do guests need an app or an account?',
        answer: 'No. They scan the code with their phone camera and upload from the browser.',
      },
      {
        question: "What if people come and go all afternoon?",
        answer: `Guests can keep adding photos through the ${UPLOAD_WINDOW_DAYS}-day upload window, so latecomers land in the same gallery as everyone else.`,
      },
      {
        question: 'Is there a free option for a smaller party?',
        answer: `Yes — a free event covers up to ${FREE_PHOTO_LIMIT} photos and one video, with a 30-day gallery afterward.`,
      },
    ],
  },
  {
    slug: 'company-events',
    metaTitle: 'Event Photo Sharing for Companies and Teams',
    navLabel: 'Corporate events',
    eyebrow: 'For companies and teams',
    h1First: "Get your team's photos",
    h1Second: 'without chasing anyone.',
    heroBody:
      'One QR code on a slide, a table, or a badge. Employees and guests upload straight from their phone, and everything lands in a gallery you control before it goes anywhere.',
    heroSlot: 'occasion-corporate',
    gallery: [
      { slot: 'how-it-works-gallery', caption: 'Review and approve from your dashboard' },
      { slot: 'live-slideshow', caption: 'Live on the screen at the venue' },
    ],
    benefits: [
      'Moderation and deletion before anything goes public',
      'Location data removed automatically',
      'Live slideshow for the big screen',
      `Corporate plan for multiple events a year ($${CORPORATE_PLAN.price}/mo)`,
    ],
    faqs: [
      {
        question: 'Can we review photos before anyone sees them?',
        answer: 'Yes. Turn on moderation and nothing appears in the gallery until you approve it.',
      },
      {
        question: 'Do photos include location data?',
        answer: 'No. GPS and other location data are removed from every photo automatically.',
      },
      {
        question: 'We run events all year — is there a plan for that?',
        answer: `The Corporate plan is $${CORPORATE_PLAN.price} a month for multiple active events under one account, rather than paying per event.`,
      },
    ],
  },
  {
    slug: 'conventions',
    metaTitle: 'QR Code Photo Wall for Conventions and Fan Events',
    navLabel: 'Conventions',
    eyebrow: 'For conventions and fan events',
    h1First: 'A shared photo wall',
    h1Second: 'for your con, meetup or fan event.',
    heroBody:
      'One code, thousands of attendees. Cosplay, panels, meetups and contests all feed the same gallery — nobody installs anything to add a photo.',
    heroSlot: 'live-slideshow',
    gallery: [
      { slot: 'how-it-works-scan', caption: 'No app for anyone to install' },
      { slot: 'home-gallery-preview', caption: 'Every panel, one gallery' },
    ],
    benefits: [
      'Cosplay photo walls on a live slideshow',
      'Moments QR codes for each panel, contest or meetup',
      'No app for thousands of attendees',
      'Moderation for all-ages events',
    ],
    faqs: [
      {
        question: 'Can we split photos by panel or meetup?',
        answer:
          'Yes. Moments QR codes let you set up a separate code for each panel, contest or meetup, all feeding the same event.',
      },
      {
        question: 'Will this work for an all-ages crowd?',
        answer: 'Yes. Turn on moderation so nothing appears in the gallery until it’s approved.',
      },
      {
        question: 'How many people can use one code?',
        answer: 'As many as show up. There’s no guest limit and no app for anyone to install.',
      },
    ],
  },
];

export function useCaseBySlug(slug: string): UseCase | undefined {
  return USE_CASES.find((uc) => uc.slug === slug);
}
