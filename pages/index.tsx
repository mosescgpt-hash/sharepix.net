import { useEffect } from 'react';
import Link from 'next/link';
import Artwork from '@/components/Artwork';
import Layout from '@/components/Layout';
import { trackEvent } from '@/lib/trackEvent';
import StyledQrCode from '@/components/StyledQrCode';
import { COMPARISONS, DIFFERENTIATORS } from '@/lib/differentiators';
import { PRICING_TIERS } from '@/lib/pricing';
import { SITE_ORIGIN, organizationJsonLd, webSiteJsonLd } from '@/lib/seo';

/**
 * The homepage, on the redesign system (docs/design-system.md).
 *
 * Pricing is read from `lib/pricing.ts` — a free trial and one paid plan.
 * Never hard-code a price here: the tier string is stamped on every existing
 * event row, so the tier table is the only thing that knows what a given event
 * was actually sold.
 *
 * Every image is a slot in `lib/imagery.ts`. With no licensed photography yet
 * each one renders a palette gradient at the right aspect ratio; when assets
 * land the registry changes and this file does not.
 */
export default function HomePage() {
  // The Discover stage.
  useEffect(() => {
    trackEvent('homepage_view');
  }, []);

  return (
    <Layout
      width="bleed"
      // Both belong on the homepage and nowhere else — a crawler wants one
      // statement of who this is, not one per page.
      structuredData={[organizationJsonLd(), webSiteJsonLd()]}
    >
      <div className="bg-canvas font-sans">
        <Hero />
        <TryItLive />
        <TheUsualWay />
        <HowItWorks />
        <PrivacyByDesign />
        <Occasions />
        <WhatYouGet />
        <Pricing />
        <ClosingCta />
      </div>
    </Layout>
  );
}

/** Headline line one bold sans, line two italic serif. The pairing is the brand. */
function Heading({ first, second }: { first: string; second: string }) {
  return (
    <h2 className="mt-3">
      <span className="spx-display block">{first}</span>
      <span className="spx-display-serif block">{second}</span>
    </h2>
  );
}

function Hero() {
  return (
    <section className="spx-section-canvas pt-12 sm:pt-20">
      <div className="spx-inner grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="spx-eyebrow">Shared event galleries</p>
          {/* The old headline was "Every moment. Everyone's perspective." — true
              of every product in this category, and therefore worth nothing
              when somebody has four tabs open comparing them. The promise now
              names the two things a guest actually experiences (nothing to
              install, nothing to join) and the thing a host finds out later
              (the file is the one the camera wrote). */}
          <h1 className="mt-3">
            <span className="spx-display block">Nothing to install.</span>
            <span className="spx-display-serif block">Nothing to sign up for.</span>
          </h1>
          <p className="spx-body mt-5 max-w-md">
            Your guests point a camera at a code and start sending photos. No app, no
            account, no phone number, nothing to explain to anyone. You get the original
            files — the full-size ones, not a squeezed copy.
          </p>
          <ul className="mt-6 flex max-w-md flex-wrap gap-x-4 gap-y-1.5 text-sm text-charcoal/70">
            {[
              'No app',
              'No guest accounts',
              'Original quality',
              'Location data removed',
              'Unlisted galleries',
              '$79 once',
            ].map((claim) => (
              <li key={claim} className="flex items-center gap-1.5">
                <span aria-hidden className="h-1 w-1 shrink-0 bg-pine" />
                {claim}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create-event" className="spx-btn-ink">
              Create an event gallery
            </Link>
            <Link href="/demo/gallery" className="spx-btn-outline">
              View a live demo gallery
            </Link>
          </div>
          <p className="mt-4 text-[0.7rem] text-charcoal/45">
            Free to try, one event per account. Photo and video allowances are for normal
            event use —{' '}
            <Link href="/fair-use" className="underline">
              see fair use
            </Link>
            .
          </p>
        </div>

        <Artwork slot="home-hero" className="spx-arch aspect-[4/5] w-full" priority />
      </div>
    </section>
  );
}

/**
 * A working QR code, in the hero, encoding the demo walkthrough.
 *
 * Deliberately a real code rather than a decorative one. The entire pitch is
 * "scanning it just works" — a mock that does nothing when somebody points a
 * phone at it would disprove the claim at the exact moment they tested it, and
 * they would be holding the evidence.
 *
 * `StyledQrCode` imports `qr-code-styling` dynamically, so putting this on the
 * homepage costs nothing until it renders. The artwork it replaces stays below
 * it on large screens, where there is room for both.
 */
function TryItLive() {
  return (
    <section className="spx-section-canvas pt-0">
      <div className="spx-inner">
        <div className="spx-card flex flex-col gap-8 p-6 sm:p-8 md:flex-row md:items-center">
          <div className="mx-auto shrink-0 bg-canvas p-3 md:mx-0">
            <StyledQrCode data={`${SITE_ORIGIN}/demo/try`} size={168} label="Try the demo" />
          </div>

          <div className="min-w-0">
            <p className="spx-eyebrow">Try it right now</p>
            <p className="mt-3 font-sans text-xl font-semibold leading-snug">
              Point your phone at that code. It is the whole guest experience.
            </p>
            <p className="spx-body mt-2 max-w-xl text-sm">
              It opens in whatever browser your phone already has — no install, no
              sign-up, nothing to undo afterwards. Exactly what your guests get, before
              you have paid for anything.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {/* Reading this on a phone, the code is useless — you cannot scan
                  the screen you are holding. The link is not a fallback behind
                  a breakpoint; it is there for everybody. */}
              <Link href="/demo/try" className="spx-btn-ink">
                Or just tap here
              </Link>
              <span className="text-xs text-charcoal/55">
                On a phone? Tapping does the same thing.
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-charcoal/10 pt-5">
              {['Zero app required', 'No account', 'Original quality', 'GPS removed'].map(
                (badge) => (
                  <span
                    key={badge}
                    className="bg-sage/60 px-2 py-1 text-[0.7rem] font-medium tracking-wide text-pine"
                  >
                    {badge}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Create your event',
    body: 'Name it, pick a date, choose a plan. We generate your QR code and a gallery link straight away.',
  },
  {
    n: '02',
    title: 'Guests scan and share',
    body: 'They point a phone camera at the code. The upload page opens in the browser — no app, no sign-up, nothing to explain.',
  },
  {
    n: '03',
    title: 'Download everything',
    body: 'Full-resolution originals in one ZIP whenever you are ready, and your guests can take theirs too.',
  },
];

function HowItWorks() {
  return (
    <section className="spx-section-ink">
      <div className="spx-inner">
        <p className="spx-eyebrow">How it works</p>
        <Heading first="Three steps." second="That's the whole thing." />
        <div className="mt-12 grid gap-10 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n}>
              <div className="spx-step-icon bg-canvas/15 text-canvas">
                <span className="spx-numeral text-lg">{step.n}</span>
              </div>
              <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
              <p className="spx-body mt-2 text-sm">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const OCCASIONS = [
  { slot: 'occasion-wedding', label: 'Weddings' },
  { slot: 'occasion-birthday', label: 'Birthdays' },
  { slot: 'occasion-graduation', label: 'Graduations' },
  { slot: 'occasion-corporate', label: 'Corporate' },
  { slot: 'occasion-holiday', label: 'Holidays' },
  { slot: 'occasion-reunion', label: 'Reunions' },
] as const;

function Occasions() {
  return (
    <section className="spx-section-sand">
      <div className="spx-inner">
        <p className="spx-eyebrow">Not just weddings</p>
        <Heading first="For everything" second="worth sharing." />
        <p className="spx-body mt-5 max-w-lg">
          Anywhere people take out their phones, SharePix collects what they shoot. Same code,
          same gallery, whatever the occasion.
        </p>
        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {OCCASIONS.map((item) => (
            <Artwork
              key={item.slot}
              slot={item.slot}
              caption={item.label}
              className="aspect-[4/3]"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The comparison block.
 *
 * Rows come from `lib/differentiators.ts`, where each one is tied to a claim
 * that a test checks against the code. The left column describes the status quo
 * — a group chat, a shared folder, an app-shaped tool — and names no product
 * and quotes no statistic, because nothing here could source one.
 */
function TheUsualWay() {
  return (
    <section className="spx-section-sand">
      <div className="spx-inner">
        <p className="spx-eyebrow">Why this is different</p>
        <Heading first="The usual way." second="And the other way." />
        <p className="spx-body mt-5 max-w-lg">
          Most of this category looks alike from the outside — everyone has a QR code and
          a slideshow. The differences show up in what happens to the files and what your
          guests are asked to do.
        </p>

        <div className="mt-10 grid gap-px overflow-hidden border border-charcoal/15 bg-charcoal/15 md:grid-cols-2">
          <div className="bg-canvas/60 p-6">
            <h3 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-charcoal/60">
              The usual way
            </h3>
            <ul className="mt-5 space-y-4">
              {COMPARISONS.map((row) => (
                <li key={row.usual} className="flex gap-3 text-sm leading-relaxed text-charcoal/70">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 bg-charcoal/30" />
                  {row.usual}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-ink p-6 text-canvas">
            <h3 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-canvas/70">
              With SharePix
            </h3>
            <ul className="mt-5 space-y-4">
              {COMPARISONS.map((row) => (
                <li key={row.sharepix} className="flex gap-3 text-sm leading-relaxed text-canvas/85">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 bg-sage" />
                  {row.sharepix}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The claims, each with the limit where it stops holding.
 *
 * The boundaries are the point. Anybody can write "private by design"; a page
 * that says which formats are covered and which are not is making a claim the
 * reader can check, and the specificity is what the vague version cannot copy.
 */
function PrivacyByDesign() {
  return (
    <section className="spx-section-canvas">
      <div className="spx-inner">
        <p className="spx-eyebrow">Privacy by design</p>
        <Heading first="What we do" second="with your guests' files." />
        <p className="spx-body mt-5 max-w-lg">
          Each of these is a specific promise rather than a posture, so each one comes
          with the case where it does not apply. A claim with no stated edge is usually
          hiding one.
        </p>

        <div className="mt-12 grid gap-px bg-charcoal/10 sm:grid-cols-2">
          {DIFFERENTIATORS.map((item) => (
            <div key={item.id} className="flex flex-col bg-canvas p-7">
              <span className="self-start bg-sage/60 px-2 py-1 text-[0.7rem] font-medium tracking-wide text-pine">
                {item.badge}
              </span>
              <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
              <p className="spx-body mt-2 text-sm">{item.claim}</p>
              <p className="mt-3 border-l-2 border-charcoal/15 pl-3 text-xs leading-relaxed text-charcoal/55">
                {item.boundary}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    title: 'Live slideshow',
    body: 'Put the gallery on a screen at the venue and watch photos appear through the evening. Screened stills only — nothing reaches the projector unchecked.',
  },
  {
    title: 'Digital guest book',
    body: 'Notes, photos and short video messages, signed by the people who were there.',
  },
  {
    title: 'Hold everything for approval',
    body: 'Switch on approvals and nothing appears until you release it. Included, not an upgrade.',
  },
  {
    title: 'One ZIP, every original',
    body: 'Download the whole event in a single archive, at full resolution. Your guests can take theirs too, without an account.',
  },
];

function WhatYouGet() {
  return (
    <section className="spx-section-canvas">
      <div className="spx-inner">
        <p className="spx-eyebrow">Also included</p>
        <Heading first="And the rest" second="of what you get." />
        <div className="mt-12 grid gap-px bg-charcoal/10 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="bg-canvas p-7">
              <h3 className="text-lg font-semibold">{feature.title}</h3>
              <p className="spx-body mt-2 text-sm">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section className="spx-section-sand">
      <div className="spx-inner">
        <p className="spx-eyebrow">Pricing</p>
        <Heading first="One event. One payment." second="No surprises." />
        <p className="spx-body mt-5 max-w-lg">
          One plan, priced per event rather than per guest or per photo. Nothing renews, and
          nothing is charged until you publish. Try it first with a free event.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {PRICING_TIERS.map((tier) => {
            const featured = tier.highlight === true;
            return (
              <div
                key={tier.id}
                className={
                  featured
                    ? 'border border-ink bg-ink p-7 text-canvas'
                    : 'spx-card p-7'
                }
              >
                {/* No "Most popular" badge: nothing has sold yet, so popularity
                    would be invented, and with one paid plan there is nothing
                    for it to be more popular than. */}
                <p
                  className={`font-sans text-xs font-medium uppercase tracking-[0.16em] ${
                    featured ? 'text-canvas/70' : 'text-charcoal/60'
                  }`}
                >
                  {tier.name}
                </p>
                <p className="mt-2 text-4xl font-bold tracking-[-0.02em]">
                  {tier.price === 0 ? 'Free' : `$${tier.price}`}
                </p>
                <ul className="mt-5 space-y-2">
                  {tier.features.slice(0, 4).map((feature) => (
                    <li
                      key={feature}
                      className={`text-sm leading-relaxed ${
                        featured ? 'text-canvas/75' : 'text-charcoal/70'
                      }`}
                    >
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/pricing"
                  className={`${featured ? 'spx-btn-canvas' : 'spx-btn-outline'} mt-7 w-full`}
                >
                  {tier.price === 0 ? 'Start free' : `Choose ${tier.name}`}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-sm text-charcoal/60">
          Running events all year?{' '}
          <Link href="/pricing" className="text-pine underline">
            The Corporate plan
          </Link>{' '}
          covers multiple active events on a monthly subscription.
        </p>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="spx-section-ink text-center">
      <div className="spx-inner">
        <p className="spx-eyebrow">Ready when you are</p>
        <h2 className="mt-3">
          <span className="spx-display block">Set it up in five minutes.</span>
          <span className="spx-display-serif block">Keep the photos forever.</span>
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/create-event" className="spx-btn-canvas">
            Create your event
          </Link>
          <Link href="/demo" className="spx-btn-outline">
            See an example gallery
          </Link>
        </div>
      </div>
    </section>
  );
}
