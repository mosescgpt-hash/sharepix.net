import { useEffect } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import HeroProduct from '@/components/HeroProduct';
import HowItWorksSection from '@/components/HowItWorksSection';
import Layout from '@/components/Layout';
import OfferBanner from '@/components/OfferBanner';
import SectionHeading from '@/components/SectionHeading';
import StyledQrCode from '@/components/StyledQrCode';
import { HOMEPAGE_PROMISES } from '@/lib/differentiators';
import { HOMEPAGE_IMAGES } from '@/lib/homepageImages';
import { CORPORATE_PLAN, getTier } from '@/lib/pricing';
import { SITE_ORIGIN, organizationJsonLd, webSiteJsonLd } from '@/lib/seo';
import { trackEvent } from '@/lib/trackEvent';

/**
 * The homepage, on the redesign system (docs/design-system.md).
 *
 * Order: banner, hero, try-it-now, three steps, promises, what is included,
 * pricing, closing call to action.
 *
 * Pricing is read from `lib/pricing.ts`. Never hard-code a price here: the tier
 * string is stamped on every existing event row, so the tier table is the only
 * thing that knows what a given event was actually sold.
 *
 * Every picture comes from `lib/homepageImages.ts`, the single manifest.
 *
 * "No app, no account" is said twice on purpose — once in the hero and once in
 * the strip under the QR code — and not again. Say it a third time and it
 * stops reading as a promise.
 */
/** Homepage sections run tighter than the design-system default (py-16/24). */
const TIGHT = '!py-10 sm:!py-14';

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
        <OfferBanner />
        <Hero />
        <TryItLive />
        <HowItWorksSection compact />
        <Promises />
        <Included />
        <Pricing />
        <ClosingCta />
      </div>
    </Layout>
  );
}

function Hero() {
  const full = getTier('plus');
  return (
    <section className="spx-section-canvas !pb-8 !pt-8 sm:!pb-10 sm:!pt-12">
      <div className="spx-inner grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="spx-eyebrow">Shared event galleries</p>
          <h1 className="mt-3">
            <span className="spx-display block">Nothing to install.</span>
            <span className="spx-display-serif block">Nothing to sign up for.</span>
          </h1>
          <p className="spx-body mt-5 max-w-md">
            Your guests scan a code and start sending photos. No app, no account. You get the
            original files, at the size the camera recorded them.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create-event" className="spx-btn-ink">
              Create an event gallery
            </Link>
            <Link href="/demo/gallery" className="spx-btn-outline">
              View a live demo gallery
            </Link>
          </div>
          <p className="mt-5 text-base font-medium">
            Free to try. {full ? `$${full.price} per event.` : null} Corporate plans available.
          </p>
          <p className="text-xs text-charcoal/70">
            Photo and video allowances are for normal event use.{' '}
            <Link
              href="/fair-use"
              className="inline-flex min-h-[44px] items-center underline"
            >
              See fair use
            </Link>
          </p>
        </div>

        <HeroProduct />
      </div>
    </section>
  );
}

/**
 * A working QR code encoding the demo walkthrough. Deliberately a real code:
 * the pitch is "scanning it just works", and a decorative one would disprove
 * that the moment somebody pointed a phone at it.
 *
 * The badges are the trust strip — the second and last place the page says
 * "no app, no account".
 */
function TryItLive() {
  return (
    <section className="spx-section-canvas !pb-10 !pt-0 sm:!pb-12">
      <div className="spx-inner">
        <div className="spx-card flex flex-col gap-8 p-6 sm:p-8 md:flex-row md:items-center">
          <div className="mx-auto shrink-0 bg-canvas p-3 md:mx-0">
            <StyledQrCode
              data={`${SITE_ORIGIN}/demo/try-upload`}
              size={168}
              label="Try an upload"
            />
          </div>

          <div className="min-w-0">
            <p className="spx-eyebrow">Try it right now</p>
            <p className="mt-3 font-sans text-xl font-semibold leading-snug">
              Point your phone at that code and add a photo yourself.
            </p>
            <p className="spx-body mt-2 max-w-xl text-sm">
              It opens a sample gallery in the browser your phone already has. Your photo is
              deleted within the hour, and no page anywhere shows it to anyone else.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {/* On a phone the code is useless — you cannot scan the screen you
                  are holding — so the link is for everybody, not a fallback. */}
              <Link href="/demo/try-upload" className="spx-btn-ink">
                Or just tap here
              </Link>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-charcoal/10 pt-5">
              {['No app, no account', 'Original quality', 'Location data removed'].map(
                (badge) => (
                  <span
                    key={badge}
                    className="bg-sage/60 px-2 py-1 text-xs font-medium tracking-wide text-pine"
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

/**
 * Four promises, each with the limit where it stops holding. The set is
 * `HOMEPAGE_PROMISE_IDS` in lib/differentiators.ts; the rest live on /pricing
 * and the use-case pages. Nothing here mentions anybody else, by decision.
 */
function Promises() {
  return (
    <section className={`spx-section-canvas ${TIGHT}`}>
      <div className="spx-inner">
        <p className="spx-eyebrow">Our standard</p>
        <SectionHeading first="What we promise" second="and exactly where it ends." />

        <div className="mt-8 grid gap-px bg-charcoal/10 sm:grid-cols-2">
          {HOMEPAGE_PROMISES.map((item) => (
            <div key={item.id} className="flex flex-col bg-canvas p-6 sm:p-7">
              <span className="self-start bg-sage/60 px-2 py-1 text-xs font-medium tracking-wide text-pine">
                {item.badge}
              </span>
              <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
              <p className="spx-body mt-2 text-sm">{item.claim}</p>
              <p className="mt-3 border-l-2 border-charcoal/15 pl-3 text-sm leading-relaxed text-charcoal/70">
                {item.boundary}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const iconProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const INCLUDED: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: 'Digital guest book',
    body: 'Signed notes, photos and short video messages.',
    icon: (
      <svg {...iconProps}>
        <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
        <path d="M9 9h6M9 13h4" />
      </svg>
    ),
  },
  {
    title: 'Automatic screening',
    body: 'Photos that look explicit are held back until you review them.',
    icon: (
      <svg {...iconProps}>
        <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: 'One ZIP, every original',
    body: 'The whole event at full resolution. Guests can take theirs too.',
    icon: (
      <svg {...iconProps}>
        <path d="M12 4v11m0 0-4-4m4 4 4-4" />
        <path d="M5 20h14" />
      </svg>
    ),
  },
  {
    title: 'Hide or delete anything',
    body: 'Remove any photo from the gallery whenever you like.',
    icon: (
      <svg {...iconProps}>
        <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
        <path d="m4 4 16 16" />
      </svg>
    ),
  },
];

function Included() {
  const slideshow = HOMEPAGE_IMAGES.slideshow;
  const dashboard = HOMEPAGE_IMAGES.hostDashboard;
  return (
    <section className={`spx-section-sand ${TIGHT}`}>
      <div className="spx-inner">
        <p className="spx-eyebrow">What you get</p>
        <SectionHeading first="Everything for the night," second="and the morning after." />

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <figure className="spx-card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slideshow.src}
              alt={slideshow.alt}
              width={slideshow.width}
              height={slideshow.height}
              loading="lazy"
              className="block h-auto w-full"
            />
            <figcaption className="p-5">
              <h3 className="text-lg font-semibold">Live slideshow</h3>
              <p className="spx-body mt-1 text-sm">
                Put the gallery on a screen at the venue and watch photos appear through the
                evening. Screened stills only — nothing reaches the projector unchecked.
              </p>
            </figcaption>
          </figure>

          <figure className="spx-card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={dashboard.src}
              alt={dashboard.alt}
              width={dashboard.width}
              height={dashboard.height}
              loading="lazy"
              className="block h-auto w-full"
            />
            <figcaption className="p-5">
              <h3 className="text-lg font-semibold">Your dashboard</h3>
              <p className="spx-body mt-1 text-sm">
                Every photo in one place, with the code to print, the slideshow and the settings
                alongside it.
              </p>
            </figcaption>
          </figure>
        </div>

        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {INCLUDED.map((item) => (
            <li key={item.title} className="flex gap-3">
              <span className="mt-0.5 shrink-0 text-pine">{item.icon}</span>
              <div>
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-charcoal/70">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Free, Full Event and Corporate, side by side. Every figure and feature comes
 * from lib/pricing.ts. "One free event per account" is filtered out here — it
 * is a rule of the free plan and lives on /pricing, not in a homepage card.
 */
function Pricing() {
  const trial = getTier('trial');
  const full = getTier('plus');
  const cards = [
    trial && {
      key: trial.id,
      name: trial.name,
      price: 'Free',
      features: trial.features.filter((f) => !/per account/i.test(f)).slice(0, 4),
      href: '/create-event',
      cta: 'Start free',
      featured: false,
    },
    full && {
      key: full.id,
      name: full.name,
      price: `$${full.price}`,
      priceNote: 'per event',
      features: full.features.filter((f) => !/no app/i.test(f)).slice(0, 4),
      href: '/create-event',
      cta: `Choose ${full.name}`,
      featured: true,
    },
    {
      key: 'corporate',
      name: CORPORATE_PLAN.name,
      price: CORPORATE_PLAN.priceLabel,
      features: CORPORATE_PLAN.features.slice(0, 4),
      href: '/corporate',
      cta: 'See Corporate',
      featured: false,
    },
  ].filter(Boolean) as {
    key: string;
    name: string;
    price: string;
    priceNote?: string;
    features: string[];
    href: string;
    cta: string;
    featured: boolean;
  }[];

  return (
    <section className={`spx-section-canvas ${TIGHT}`}>
      <div className="spx-inner">
        <p className="spx-eyebrow">Pricing</p>
        <SectionHeading first="One event. One payment." second="No surprises." />
        <p className="spx-body mt-5 max-w-lg">
          Priced per event, not per guest or per photo. Nothing renews.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.key}
              className={`flex flex-col p-7 ${
                card.featured ? 'border border-ink bg-ink text-canvas' : 'spx-card'
              }`}
            >
              <p
                className={`font-sans text-xs font-medium uppercase tracking-[0.16em] ${
                  card.featured ? 'text-canvas/70' : 'text-charcoal/70'
                }`}
              >
                {card.name}
              </p>
              <p className="mt-2 text-3xl font-bold tracking-[-0.02em]">
                {card.price}
                {card.priceNote ? (
                  <span
                    className={`ml-2 text-sm font-medium tracking-normal ${
                      card.featured ? 'text-canvas/70' : 'text-charcoal/70'
                    }`}
                  >
                    {card.priceNote}
                  </span>
                ) : null}
              </p>
              <ul className="mt-5 flex-1 space-y-2">
                {card.features.map((feature) => (
                  <li
                    key={feature}
                    className={`text-sm leading-relaxed ${
                      card.featured ? 'text-canvas/75' : 'text-charcoal/70'
                    }`}
                  >
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href={card.href}
                className={`${card.featured ? 'spx-btn-canvas' : 'spx-btn-outline'} mt-7 w-full`}
              >
                {card.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-6 text-sm text-charcoal/70">
          <Link href="/pricing" className="inline-flex min-h-[44px] items-center text-pine underline">
            Compare every plan
          </Link>
        </p>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className={`spx-section-ink text-center ${TIGHT}`}>
      <div className="spx-inner">
        <p className="spx-eyebrow">Ready when you are</p>
        <h2 className="mt-3">
          <span className="spx-display block">Set it up in five minutes.</span>
          {/* Not "keep the photos forever": the gallery has a window and the
              archive after it has an end. What is permanent is the copy a host
              downloads, and that is what this promises. */}
          <span className="spx-display-serif block">Download the originals and keep them.</span>
        </h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/create-event" className="spx-btn-canvas">
            Create your event
          </Link>
          <Link href="/demo" className="spx-btn-outline">
            See an example gallery
          </Link>
        </div>
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-1 text-sm text-canvas/75">
          Planning
          <Link href="/weddings" className="inline-flex min-h-[44px] items-center px-1 underline">
            a wedding
          </Link>
          ,
          <Link href="/company-events" className="inline-flex min-h-[44px] items-center px-1 underline">
            a company event
          </Link>
          or
          <Link href="/graduation-parties" className="inline-flex min-h-[44px] items-center px-1 underline">
            a party
          </Link>
          ?
        </p>
      </div>
    </section>
  );
}
