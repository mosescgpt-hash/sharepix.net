import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import PricingCards from '@/components/PricingCards';
import HomepageEventAccess from '@/components/HomepageEventAccess';
import { getCurrentUserInfo } from '@/lib/api';
import { PRICING_TIERS } from '@/lib/pricing';

const steps = [
  {
    title: 'Create your event',
    body: 'Pick a plan, name your event, and get a QR code in under a minute.',
  },
  {
    title: 'Print the QR code',
    body: 'Put it on tables, invitations, or a welcome sign. No app for guests to install.',
  },
  {
    title: 'Guests scan & upload',
    body: 'Anyone with a phone camera can add photos straight to your gallery.',
  },
  {
    title: 'Relive every angle',
    body: 'Browse, moderate, and download every photo your guests captured.',
  },
];

// Said plainly under the hero. A visitor deciding whether this is a real
// product wants the objections answered before they click anything.
const assurances = [
  'No app for your guests',
  'Full-resolution downloads',
  'You own every photo',
];

const startingPrice = Math.min(...PRICING_TIERS.map((tier) => tier.price));

export default function HomePage() {
  const router = useRouter();

  // Signed-in hosts go straight to their account page; guests see the homepage.
  useEffect(() => {
    getCurrentUserInfo()
      .then((user) => {
        if (user) void router.replace('/my-events');
      })
      .catch(() => undefined);
  }, [router]);

  return (
    <Layout width="wide">
      {/* Hero */}
      <section className="py-14 text-center sm:py-24">
        <p className="sp-eyebrow">Capture. Connect. Celebrate.</p>
        <h1 className="mx-auto mt-5 max-w-3xl font-display text-[2.75rem] font-bold leading-[1.05] tracking-[-0.035em] sm:text-7xl">
          Every guest is a{' '}
          <span className="relative whitespace-nowrap text-accent">
            photographer
            {/* A drawn underline rather than a highlighter block behind the
                word. The old rectangle cut through the descenders and read
                like a comment left in a document. */}
            <span
              aria-hidden
              className="absolute inset-x-0 -bottom-1 h-[0.09em] rounded-full bg-gradient-to-r from-mint/40 via-accent to-mint/40"
            />
          </span>
          .
        </h1>
        <p className="mx-auto mt-7 max-w-xl text-lg leading-relaxed text-muted">
          sharepix.net collects every photo taken at your wedding, birthday, or
          company party into one shared gallery. One QR code, zero apps.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link href="/create-event" className="sp-btn-primary w-full sm:w-auto">
            Create your event
          </Link>
          <Link href="/demo" className="sp-btn-ghost w-full sm:w-auto">
            See a live example
          </Link>
        </div>
        {/* Pricing is stated rather than made a third equal button. Three
            same-weight buttons is a menu, not a call to action. */}
        <p className="mt-5 text-sm text-muted">
          Pay per event from ${startingPrice} ·{' '}
          <Link href="/pricing" className="font-medium text-ink underline decoration-line underline-offset-4 transition hover:decoration-accent">
            see every plan
          </Link>
        </p>

        <ul className="mx-auto mt-12 flex max-w-2xl flex-col items-center justify-center gap-2 text-sm text-muted sm:flex-row sm:gap-7">
          {assurances.map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mint" />
              {item}
            </li>
          ))}
        </ul>
      </section>

      <HomepageEventAccess />

      {/* How it works */}
      <section className="py-16 sm:py-20">
        <div className="text-center">
          <p className="sp-eyebrow">How it works</p>
          <h2 className="mx-auto mt-4 max-w-xl font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            Four steps, and the first one takes a minute
          </h2>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step.title} className="sp-card sp-card-interactive relative overflow-hidden p-6">
              {/* A ghosted numeral behind the text instead of a small green
                  digit above it: it gives the card a focal point and a
                  reason to have this much space in it. */}
              <span
                aria-hidden
                className="pointer-events-none absolute right-4 top-3 select-none font-display text-6xl font-bold leading-none text-ink/[0.055]"
              >
                {i + 1}
              </span>
              <span className="sp-eyebrow">Step {i + 1}</span>
              <h3 className="mt-3 font-display text-lg font-bold tracking-tight">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
            </div>
          ))}
        </div>
        {/* The steps describe it; the demo shows it. Prospects who want proof
            rather than prose should not have to sign up to get it. */}
        <p className="mt-10 text-center">
          <Link
            href="/demo"
            className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition hover:gap-3"
          >
            See a worked example — a sample gallery and live slideshow
            <span aria-hidden>→</span>
          </Link>
        </p>
      </section>

      {/* Pricing preview */}
      <section className="py-16 sm:py-20">
        <div className="text-center">
          <p className="sp-eyebrow">Pricing</p>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            One price per event
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-muted">
            Choose the plan that fits your event size, pay once, and you&apos;re done.
          </p>
        </div>
        <div className="mt-12">
          <PricingCards />
        </div>
      </section>
    </Layout>
  );
}
