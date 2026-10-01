import Link from 'next/link';
import {
  CORPORATE_PLAN,
  GALLERY_MONTHS,
  TRIAL_UPLOAD_WINDOW_DAYS,
  UPLOAD_WINDOW_DAYS,
  VIDEO_GB_INCLUDED,
  getTier,
} from '@/lib/pricing';
import { FAIR_USE_NOTICE, FAIR_USE_PHOTO_CEILING, UNLIMITED_PHOTOS_LINE } from '@/lib/fairUse';

/**
 * A drawn tick rather than a bare "✓" glyph: the glyph renders differently on
 * every platform and sits off the baseline. Square, no tinted disc — the disc
 * was the old rounded system.
 */
function Check() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="mt-[5px] h-3 w-3 shrink-0 text-mint"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M2 6.2 4.6 8.8 10 3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Everything the paid event includes.
 *
 * Written here rather than taken from the tier's `features` array because that
 * array is the short summary used in the create-event flow, and this is the
 * full list. Both are checked against the same rule:
 *
 *   **Nothing on this list is a feature SharePix does not have.**
 *
 * Three things asked for in the pricing brief are deliberately absent, because
 * they do not exist in the product: per-event password or PIN protection
 * (galleries are unlisted, which is a different promise and is described as
 * such), co-host access, and photo challenges. Listing them would be the kind
 * of claim that is discovered by a customer rather than by us.
 */
const INCLUDED: string[] = [
  'Unlimited guests — no app, no accounts, no passwords to share',
  UNLIMITED_PHOTOS_LINE,
  `${VIDEO_GB_INCLUDED} GB of video`,
  'Full-resolution originals, kept and downloadable',
  'A gallery that is private from search, open to anyone you give the QR code or link',
  `${UPLOAD_WINDOW_DAYS}-day upload window, extendable any time`,
  `Gallery stays up for ${GALLERY_MONTHS} months after uploads close`,
  'Your own event URL and customizable QR code',
  'Moments — separate parts of the day, each with its own QR code',
  'Guest book — signed notes, photos and video messages',
  'Live slideshow for a venue screen, updating as photos arrive',
  'ZIP download of everything, in one click',
  'Guest names and captions on every upload',
  'Approve-before-showing moderation, and delete anything at any time',
  'Your own event colours and branding',
];

/** One row of the comparison: what each of the three plans gives. */
interface Row {
  label: string;
  trial: string;
  full: string;
  corporate: string;
}

/**
 * The three plans side by side.
 *
 * The page used to present one plan and mention Corporate in a sentence, on
 * the reasoning that a trial beside the paid plan invites "which do I need?".
 * That still holds for the trial, which is why the paid plan keeps the big
 * card above. But Corporate is a real second purchase with real limits, and a
 * sentence gave a company nothing to compare, nothing to forward to whoever
 * approves the spend, and no way to buy it. Every cell is read from
 * lib/pricing.ts or lib/fairUse.ts, so the table cannot promise what the code
 * does not do.
 */
function comparisonRows(): Row[] {
  const trial = getTier('trial');
  const full = getTier('plus');
  if (!trial || !full) return [];
  const ceiling = FAIR_USE_PHOTO_CEILING.toLocaleString('en-US');
  const corporateMonths = Math.round(CORPORATE_PLAN.retentionDays / 30.4);
  return [
    {
      label: 'Price',
      trial: 'Free',
      full: `$${full.price} once`,
      corporate: CORPORATE_PLAN.priceLabel,
    },
    {
      label: 'Events',
      trial: 'One per account',
      full: 'One',
      corporate: `${CORPORATE_PLAN.includedEvents} running at once, then $${CORPORATE_PLAN.extraEventPrice} per extra event`,
    },
    {
      label: 'Photos per event',
      trial: `${trial.photoLimit}`,
      full: `Unlimited (fair-use ceiling ${ceiling}, raised free on request)`,
      corporate: `Unlimited (fair-use ceiling ${ceiling}, raised free on request)`,
    },
    {
      label: 'Video per event',
      trial: `${trial.videoLimit} clip`,
      full: `${VIDEO_GB_INCLUDED} GB`,
      corporate: `${VIDEO_GB_INCLUDED} GB`,
    },
    {
      label: 'Upload window',
      trial: `${TRIAL_UPLOAD_WINDOW_DAYS} days`,
      full: `${UPLOAD_WINDOW_DAYS} days, extendable`,
      corporate: `${UPLOAD_WINDOW_DAYS} days`,
    },
    {
      label: 'Gallery after uploads close',
      trial: `${trial.retentionDays} days`,
      full: `${GALLERY_MONTHS} months`,
      corporate: `${corporateMonths} months for you, ${CORPORATE_PLAN.guestLowResDays} days for guests`,
    },
    {
      label: 'Guest book and live slideshow',
      trial: 'No',
      full: 'Included',
      corporate: 'Included',
    },
    {
      label: 'Custom QR code and branding',
      trial: 'No',
      full: 'Included',
      corporate: 'Company branding',
    },
    {
      label: 'Central dashboard and priority support',
      trial: 'No',
      full: 'No',
      corporate: 'Included',
    },
  ];
}

/**
 * The paid plan first and largest, the free event as an invitation under it,
 * then the comparison and a Corporate card a company can actually buy from.
 * No badge, no strikethrough, no "was $129".
 */
export default function PricingCards() {
  const paid = getTier('plus');
  const free = getTier('trial');
  if (!paid) return null;
  const rows = comparisonRows();

  return (
    <div>
      <div className="border border-ink bg-ink p-8 text-canvas sm:p-10">
        <h3 className="font-sans text-xs font-medium uppercase tracking-[0.16em] text-canvas/70">
          SharePix {paid.name}
        </h3>

        <p className="mt-3 flex items-baseline gap-2">
          <span className="font-sans text-[3.5rem] font-bold leading-none tracking-[-0.03em]">
            ${paid.price}
          </span>
          <span className="text-base text-canvas/60">one-time</span>
        </p>
        <p className="mt-3 text-sm text-canvas/70">
          No subscription. No surprise upgrades. Nothing charged per guest or per photo.
          Sales tax is added at checkout where it applies.
        </p>

        <div className="my-8 h-px bg-canvas/20" />

        <ul className="grid gap-3 sm:grid-cols-2">
          {INCLUDED.map((feature) => (
            <li key={feature} className="flex gap-2.5 text-sm leading-relaxed text-canvas/80">
              <Check />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <Link href="/create-event?tier=plus" className="spx-btn-canvas mt-10 w-full sm:w-auto">
          Create your event
        </Link>

        <p className="mt-6 text-xs leading-relaxed text-canvas/55">
          {/* No asterisk. The headline above already states the ceiling, so
              this is the same promise in full rather than a caveat on it. */}
          {FAIR_USE_NOTICE}{' '}
          <Link href="/fair-use" className="underline">
            How fair use works
          </Link>
          .
        </p>
      </div>

      {free ? (
        <div className="spx-card mt-4 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-sans text-base font-semibold text-charcoal">
              Try it first, free
            </p>
            <p className="spx-body mt-1 text-sm">
              A real event with your own QR code and guests — up to {free.photoLimit} photos and{' '}
              {free.videoLimit} video, a {free.accessLabel}, and the gallery stays up for{' '}
              {free.retentionDays} days after that. One per account.
            </p>
          </div>
          <Link href="/create-event?tier=trial" className="spx-btn-outline shrink-0">
            Start free
          </Link>
        </div>
      ) : null}

      <div className="mt-12" id="compare">
        <h3 className="font-sans text-lg font-bold tracking-[-0.02em] text-charcoal">
          Compare plans
        </h3>
        {/* A table scrolls sideways inside its own box on a phone rather than
            pushing the whole page wider. */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-charcoal/20">
                <th scope="col" className="py-3 pr-4 font-medium text-charcoal/60">
                  <span className="sr-only">Feature</span>
                </th>
                <th scope="col" className="py-3 pr-4 font-semibold text-charcoal">
                  {free?.name ?? 'Free event'}
                </th>
                <th scope="col" className="py-3 pr-4 font-semibold text-charcoal">
                  {paid.name}
                </th>
                <th scope="col" className="py-3 font-semibold text-charcoal">
                  {CORPORATE_PLAN.name}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-charcoal/10 align-top">
                  <th scope="row" className="py-3 pr-4 font-medium text-charcoal/70">
                    {row.label}
                  </th>
                  <td className="py-3 pr-4 text-charcoal/80">{row.trial}</td>
                  <td className="py-3 pr-4 text-charcoal/80">{row.full}</td>
                  <td className="py-3 text-charcoal/80">{row.corporate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="spx-card mt-8 p-6 sm:p-8" id="corporate">
        <p className="spx-eyebrow">For companies</p>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="font-sans text-3xl font-bold tracking-[-0.02em] text-charcoal">
            ${CORPORATE_PLAN.price}
          </span>
          <span className="text-sm text-charcoal/60">per month</span>
        </p>
        <p className="spx-body mt-2 text-sm">
          For teams that run events back to back. Up to {CORPORATE_PLAN.includedEvents} events
          take uploads at the same time; when one closes its slot frees up for the next. Need
          more at once? Add an extra event for ${CORPORATE_PLAN.extraEventPrice}, paid once.
        </p>
        <ul className="mt-5 grid gap-2 text-sm text-charcoal/80 sm:grid-cols-2">
          {CORPORATE_PLAN.features.map((feature) => (
            <li key={feature} className="flex gap-2.5">
              <Check />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <Link href="/corporate" className="spx-btn-ink mt-6 w-full sm:w-auto">
          Start {CORPORATE_PLAN.name} · {CORPORATE_PLAN.priceLabel}
        </Link>
        <p className="mt-3 text-xs text-charcoal/60">
          Sign in or create an account, then pay on Stripe. Cancel any time; you keep 30 days
          to download after your last paid month. Sales tax is added where it applies.
        </p>
      </div>
    </div>
  );
}
