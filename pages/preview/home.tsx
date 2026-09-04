import Head from 'next/head';
import Link from 'next/link';
import Artwork from '@/components/Artwork';
import Layout from '@/components/Layout';
import { PRICING_TIERS } from '@/lib/pricing';

/**
 * PHASE 3 PREVIEW — not the live homepage.
 *
 * `/` is untouched. This route exists so the redesign can be looked at on a
 * real phone, built from the real tokens and the real `spx-` primitives,
 * before anything ships. If it is approved, Phase 3 is largely this file
 * moving to `pages/index.tsx`.
 *
 * Two things are deliberately NOT redesigned here:
 *
 * 1. **Pricing is the live pricing** — Starter $19 / Standard $39 / Premium
 *    $79, read from `lib/pricing.ts`. The brief proposes Free / $39 / $69,
 *    but the audit found that change is a migration touching five places
 *    including every existing event row, so the preview must not imply it has
 *    happened.
 * 2. **Every image is a placeholder.** There is no photography yet. The tiles
 *    are palette gradients at the correct aspect ratios via `lib/imagery.ts`;
 *    when assets land the layout does not move.
 */
export default function HomePreview() {
  return (
    <Layout title="Phase 3 preview" width="bleed">
      {/* A preview route should never be indexed or outrank the real homepage. */}
      <Head>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="bg-canvas font-sans">
        <PreviewBanner />
        <Hero />
        <HowItWorks />
        <Occasions />
        <WhatYouGet />
        <Pricing />
        <ClosingCta />
      </div>
    </Layout>
  );
}

function PreviewBanner() {
  return (
    <div className="bg-charcoal px-5 py-3 text-center font-sans text-[0.7rem] uppercase tracking-[0.18em] text-canvas/80">
      Phase 3 preview — the live site is unchanged
    </div>
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
          <h1 className="mt-3">
            <span className="spx-display block">Every moment.</span>
            <span className="spx-display-serif block">Everyone&rsquo;s perspective.</span>
          </h1>
          <p className="spx-body mt-5 max-w-md">
            One QR code on the table. Every guest&rsquo;s camera. All your photos land in one
            private gallery — no app to install, no account to make, and nobody to chase
            afterwards.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create-event" className="spx-btn-ink">
              Create your event
            </Link>
            <Link href="/demo/try" className="spx-btn-outline">
              Try the demo
            </Link>
          </div>
          <div className="mt-10 grid max-w-md grid-cols-3 gap-6">
            <Stat figure="847" label="Photos shared" />
            <Stat figure="62" label="Guests" />
            <Stat figure="0" label="Apps to install" />
          </div>
          {/* The stat row is illustrative on a marketing page. Labelled as such
              rather than dressed up as platform metrics we are not measuring. */}
          <p className="mt-4 text-[0.7rem] text-charcoal/45">Figures from a typical wedding.</p>
        </div>

        <Artwork slot="home-hero" className="spx-arch aspect-[4/5] w-full" priority />
      </div>
    </section>
  );
}

function Stat({ figure, label }: { figure: string; label: string }) {
  return (
    <div>
      <p className="spx-stat-figure">{figure}</p>
      <p className="spx-stat-label">{label}</p>
    </div>
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

const FEATURES = [
  {
    title: 'Private by default',
    body: 'Galleries are reachable by link, served through signed URLs, and never listed publicly. Location data is stripped from photos as they arrive.',
  },
  {
    title: 'Moderation when you want it',
    body: 'Hold uploads for approval and release them yourself. Every still is screened automatically before it reaches the gallery.',
  },
  {
    title: 'Live slideshow',
    body: 'Put the gallery on a screen at the venue and watch photos appear through the evening.',
  },
  {
    title: 'Digital guest book',
    body: 'Notes, photos and short video messages, signed by the people who were there.',
  },
];

function WhatYouGet() {
  return (
    <section className="spx-section-canvas">
      <div className="spx-inner">
        <p className="spx-eyebrow">What you get</p>
        <Heading first="Easy. Beautiful." second="Private." />
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
          Priced per event, not per guest or per photo. Nothing renews, and nothing is charged
          until you publish.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
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
                {featured ? <span className="spx-badge bg-mint text-charcoal">Most popular</span> : null}
                <p
                  className={`${featured ? 'mt-4' : ''} font-sans text-xs font-medium uppercase tracking-[0.16em] ${
                    featured ? 'text-canvas/70' : 'text-charcoal/60'
                  }`}
                >
                  {tier.name}
                </p>
                <p className="mt-2 text-4xl font-bold tracking-[-0.02em]">${tier.price}</p>
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
                  Choose {tier.name}
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
          covers unlimited events on a monthly subscription.
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
