import Link from 'next/link';
import Layout from '@/components/Layout';
import PricingCards from '@/components/PricingCards';

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

export default function HomePage() {
  return (
    <Layout>
      {/* Hero */}
      <section className="py-10 text-center sm:py-16">
        <p className="mb-3 font-medium uppercase tracking-[0.2em] text-accent">
          Capture. Connect. Celebrate.
        </p>
        <h1 className="mx-auto max-w-2xl font-display text-4xl font-extrabold leading-tight sm:text-6xl">
          Every guest is a <span className="bg-accent/15 px-2 text-accent">photographer</span>.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg text-ink/70">
          sharepix.net collects every photo taken at your wedding, birthday, or
          company party into one shared gallery. One QR code, zero apps.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/create-event"
            className="rounded-full bg-ink px-8 py-3 font-medium text-white hover:bg-night"
          >
            Create your event
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border border-ink/20 px-8 py-3 font-medium hover:border-accent hover:text-accent"
          >
            See pricing
          </Link>
        </div>
        <p className="mt-4 text-sm text-ink/50">
          Pay per event, with a monthly Corporate option coming soon.
        </p>
      </section>

      {/* How it works */}
      <section className="py-10">
        <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
          How it works
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step.title} className="rounded-2xl border border-ink/10 bg-white p-5">
              <span className="font-display text-3xl font-bold text-accent">{i + 1}</span>
              <h3 className="mt-2 font-display text-lg font-bold">{step.title}</h3>
              <p className="mt-1 text-sm text-ink/70">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing preview */}
      <section className="py-10">
        <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
          One price per event
        </h2>
        <p className="mt-2 text-center text-ink/70">
          Choose the plan that fits your event size, pay once, and you&apos;re done.
        </p>
        <div className="mt-8">
          <PricingCards />
        </div>
      </section>
    </Layout>
  );
}
