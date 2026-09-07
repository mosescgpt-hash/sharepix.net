import Link from 'next/link';
import { CORPORATE_PLAN, getTier } from '@/lib/pricing';
import { FAIR_USE_NOTICE } from '@/lib/fairUse';

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
  'Unlimited photo uploads*',
  'Up to 30 videos',
  'Full-resolution originals, kept and downloadable',
  'A private, unlisted gallery only your link and QR code reach',
  '60-day upload window, extendable any time',
  'Gallery stays up for 12 months after uploads close',
  'Your own event URL and customizable QR code',
  'Moments — separate parts of the day, each with its own QR code',
  'Guest book — signed notes, photos and video messages',
  'Live slideshow for a venue screen, updating as photos arrive',
  'ZIP download of everything, in one click',
  'Guest names and captions on every upload',
  'Approve-before-showing moderation, and delete anything at any time',
  'Your own event colours and branding',
];

/**
 * One plan, presented as one plan.
 *
 * This used to be a row of cards to compare. There is nothing to compare: the
 * free event is a trial rather than a cheaper tier, and setting it beside the
 * paid plan as an equal column invited exactly the wrong question — *which of
 * these do I need?* — about a product whose whole pitch is that there is one
 * price and it covers everything.
 *
 * So the paid plan is the page, the free event is an invitation underneath it,
 * and Corporate is a line of prose. No badge, no comparison table, no
 * strikethrough, no "was $129". A single confident price does not need
 * decoration, and decoration would undercut it.
 */
export default function PricingCards() {
  const paid = getTier('plus');
  const free = getTier('free');
  if (!paid) return null;

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
          {/* The asterisk has something behind it — both this sentence and a
              real section in the terms. One that did not would be worse than no
              asterisk at all. */}
          *{FAIR_USE_NOTICE}{' '}
          <Link href="/terms#fair-use" className="underline">
            Read the fair-use section
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
              {free.videoLimit} video, and the gallery stays up for {free.retentionDays} days.
              One per account.
            </p>
          </div>
          <Link href="/create-event?tier=free" className="spx-btn-outline shrink-0">
            Start free
          </Link>
        </div>
      ) : null}

      <p className="spx-body mt-6 text-sm">
        Running events for a company?{' '}
        <Link href="/corporate" className="font-medium text-pine underline">
          {CORPORATE_PLAN.name} is {CORPORATE_PLAN.priceLabel}
        </Link>{' '}
        and covers multiple active events under one account.
      </p>
    </div>
  );
}
