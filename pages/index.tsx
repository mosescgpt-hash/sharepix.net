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
const TIGHT = '!py-8 sm:!py-10';

export default function HomePage() {
  // The Discover stage.
  useEffect(() => {
    trackEvent('homepage_view');
  }, []);

  return (
    <Layout
      width="bleed"
      compactFooter
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
    <section className="spx-section-canvas !pb-6 !pt-6 sm:!pb-8 sm:!pt-8">
      <div className="spx-inner grid items-center gap-5 lg:grid-cols-2 lg:gap-10">
        <div>
          <p className="spx-eyebrow">Shared event galleries</p>
          <h1 className="mt-2">
            <span className="spx-display block !text-[1.9rem] sm:!text-5xl">Nothing to install.</span>
            <span className="spx-display-serif block !text-[1.9rem] sm:!text-5xl">Nothing to sign up for.</span>
          </h1>
          <p className="spx-body mt-3 max-w-md text-[0.95rem] leading-snug">
            Your guests scan a code and start sending photos. No app, no account. You get the
            original files, at the size the camera recorded them.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/create-event" className="spx-btn-ink !px-5 !py-3">
              Create an event
            </Link>
            <Link href="/demo/gallery" className="spx-btn-outline !px-5 !py-3">
              See a live demo
            </Link>
          </div>
          <p className="mt-3 text-sm font-medium sm:text-base">
            Free to try. {full ? `$${full.price} per event.` : null} Corporate plans available.
          </p>
          <p className="mt-1 text-xs text-charcoal/70">
            Photo and video allowances are for normal event use.{' '}
            <Link
              href="/fair-use"
              className="-my-3 inline-block min-h-[44px] py-3 underline"
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
    <section className="spx-section-canvas !pb-8 !pt-0 sm:!pb-10">
      <div className="spx-inner">
        <div className="spx-card flex flex-col gap-4 p-4 sm:p-6 md:flex-row md:items-center md:gap-8">
          <div className="mx-auto shrink-0 bg-canvas p-2 md:mx-0">
            <StyledQrCode
              data={`${SITE_ORIGIN}/demo/try-upload`}
              size={136}
              label="Try an upload"
            />
          </div>

          <div className="min-w-0">
            <p className="spx-eyebrow">Try it right now</p>
            <p className="mt-2 font-sans text-lg font-semibold leading-snug sm:text-xl">
              Point your phone at that code and add a photo yourself.
            </p>
            <p className="spx-body mt-1 max-w-xl text-sm leading-snug">
              It opens a sample gallery in your phone's browser. Your photo is deleted within the
              hour and never shown to anyone else.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {/* On a phone the code is useless — you cannot scan the screen you
                  are holding — so the link is for everybody, not a fallback. */}
              <Link href="/demo/try-upload" className="spx-btn-ink !py-3">
                Or just tap here
              </Link>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-charcoal/10 pt-3">
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
        <SectionHeading first="What we promise" second="and exactly where it ends." compact />

        <div className="mt-5 grid gap-px bg-charcoal/10 sm:grid-cols-2">
          {HOMEPAGE_PROMISES.map((item) => (
            <div key={item.id} className="flex flex-col bg-canvas px-4 py-4 sm:px-5 sm:py-3">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="spx-body mt-1 text-sm leading-snug">{item.short ?? item.claim}</p>
              <p className="mt-2 border-l-2 border-charcoal/15 pl-3 text-xs leading-snug text-charcoal/70">
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
    body: 'Explicit-looking photos are held back until you review them.',
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
  const shots = [
    {
      image: slideshow,
      title: 'Live slideshow',
      body: 'Put the gallery on a screen at the venue. Screened stills only, so nothing reaches the projector unchecked.',
    },
    {
      image: dashboard,
      title: 'Your dashboard',
      body: 'Every photo in one place, with the code to print, the slideshow and the settings.',
    },
  ];
  return (
    <section className={`spx-section-sand ${TIGHT}`}>
      <div className="spx-inner">
        <p className="spx-eyebrow">What you get</p>
        <SectionHeading first="Everything for the night," second="and the morning after." compact />

        {/* Side by side at every width: the pair is one picture of the product,
            and stacking them doubled the section on a phone. */}
        <div className="mt-5 grid grid-cols-[1.5fr_1fr] gap-3 sm:gap-5">
          {shots.map(({ image, title, body }) => (
            <figure key={title} className="spx-card overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                loading="lazy"
                className="block h-auto w-full"
              />
              <figcaption className="px-3 py-2 sm:px-4 sm:py-3">
                <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
                <p className="mt-1 hidden text-sm leading-snug text-charcoal/70 sm:block">{body}</p>
              </figcaption>
            </figure>
          ))}
        </div>

        <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4">
          {INCLUDED.map((item) => (
            <li key={item.title} className="flex gap-2 sm:gap-3">
              <span className="mt-0.5 shrink-0 text-pine">{item.icon}</span>
              <div>
                <h3 className="text-sm font-semibold leading-tight">{item.title}</h3>
                <p className="mt-1 text-xs leading-snug text-charcoal/70 sm:text-sm">{item.body}</p>
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
      features: trial.features.filter((f) => !/per account/i.test(f)).slice(0, 3),
      href: '/create-event',
      cta: 'Start free',
      featured: false,
    },
    full && {
      key: full.id,
      name: full.name,
      price: `$${full.price}`,
      priceNote: 'per event',
      features: full.features.filter((f) => !/no app/i.test(f)).slice(0, 3),
      href: '/create-event',
      cta: `Choose ${full.name}`,
      featured: true,
    },
    {
      key: 'corporate',
      name: CORPORATE_PLAN.name,
      price: CORPORATE_PLAN.priceLabel,
      features: CORPORATE_PLAN.features.slice(0, 3),
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
        <SectionHeading first="One event. One payment." second="No surprises." compact />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6">
          <p className="spx-body max-w-lg text-[0.95rem] leading-snug">
            Priced per event, not per guest or per photo. Nothing renews.
          </p>
          <Link href="/pricing" className="hidden min-h-[44px] items-center text-sm text-pine underline sm:inline-flex">
            Compare every plan
          </Link>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3 md:gap-4">
          {cards.map((card) => (
            <div
              key={card.key}
              className={`flex flex-col p-4 sm:p-5 ${
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
              <p className="mt-1 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
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
              <ul className="mt-3 flex-1 space-y-1.5">
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
                className={`${card.featured ? 'spx-btn-canvas' : 'spx-btn-outline'} mt-4 w-full !py-3`}
              >
                {card.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-2 text-sm text-charcoal/70 sm:hidden">
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
        <h2 className="mt-2">
          <span className="spx-display block !text-[1.65rem] sm:!text-4xl">Set it up in five minutes.</span>
          {/* Not "keep the photos forever": the gallery has a window and the
              archive after it has an end. What is permanent is the copy a host
              downloads, and that is what this promises. */}
          <span className="spx-display-serif block !text-[1.65rem] sm:!text-4xl">Download the originals and keep them.</span>
        </h2>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/create-event" className="spx-btn-canvas !px-5 !py-3">
            Create your event
          </Link>
          <Link href="/demo" className="spx-btn-outline !px-5 !py-3">
            See an example
          </Link>
        </div>
        <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1 text-sm text-canvas/75">
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
