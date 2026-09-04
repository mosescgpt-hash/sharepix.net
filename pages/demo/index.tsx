import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import Layout from '@/components/Layout';
import { DEMO_EVENT } from '@/lib/demoEvent';
import { TENT_HEIGHT_IN, TENT_WIDTH_IN, tentContent } from '@/lib/tableTent';

/**
 * The public worked example: what a host sets up, what guests see, and what
 * goes on the screen at the venue.
 *
 * Everything here is generated — see lib/demoEvent.ts. No real event is
 * touched, and the QR codes point at the demo pages rather than at anything
 * that would accept an upload.
 */

const SETUP_STEPS = [
  {
    title: 'Name it and pick a plan',
    body: 'A minute of typing. You get an event code and a QR code straight away, before you have paid anything.',
  },
  {
    title: 'Print the QR code',
    body: 'A table tent on every table, a sign by the door, or on the back of the invitations. Guests need no app and no account.',
  },
  {
    title: 'Guests scan and upload',
    body: 'The camera opens, they shoot or pick from their gallery, and the photos land in your event within seconds.',
  },
  {
    title: 'Everything in one place',
    body: 'Browse every angle of your day, download the lot as a ZIP, and order prints of the ones you love.',
  },
];

export default function DemoPage() {
  const uploadUrl = 'https://www.sharepix.net/demo/gallery';
  // The real generator, so the demo tent says exactly what a printed one says.
  const tent = tentContent(
    {
      name: DEMO_EVENT.name,
      eventCode: DEMO_EVENT.eventCode,
      date: DEMO_EVENT.date,
      location: DEMO_EVENT.location,
    },
    uploadUrl,
  );

  return (
    <Layout title="See how it works">
      <section className="py-10">
        <div className="text-center">
          <p className="sp-eyebrow">
            A worked example
          </p>
          <h1 className="mx-auto max-w-2xl font-display text-3xl font-bold leading-tight sm:text-5xl">
            This is what your guests will see.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-ink/70">
            A pretend wedding, set up exactly the way a real one would be. Have a
            look around — nothing here is live, and nothing you do can break it.
          </p>
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/demo/try" className="sp-btn-primary">
            Try it with your own photo
          </Link>
          <Link
            href="/demo/gallery"
            className="sp-btn-ghost"
          >
            Open the sample gallery
          </Link>
          <Link
            href="/demo/live"
            className="sp-btn-ghost"
          >
            See the live slideshow
          </Link>
          <Link
            href="/demo/guestbook"
            className="group sp-card sp-card-interactive p-6 hover:border-accent/40"
          >
            <h3 className="font-display text-xl font-bold group-hover:text-accent">
              The guest book &rarr;
            </h3>
            <p className="mt-2 text-sm text-ink/70">
              Signed notes guests leave alongside their photos &mdash; a message, a
              picture, or a short video message.
            </p>
          </Link>
        </div>
      </section>

      {/* What the host sets up */}
      <section className="py-8">
        <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
          What you set up
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SETUP_STEPS.map((step, i) => (
            <div key={step.title} className="sp-card sp-card-interactive relative overflow-hidden p-6">
              <span
                aria-hidden
                className="pointer-events-none absolute right-4 top-3 select-none font-display text-6xl font-bold leading-none text-ink/[0.055]"
              >
                {i + 1}
              </span>
              <span className="sp-eyebrow">Step {i + 1}</span>
              <h3 className="mt-2 font-display text-lg font-bold">{step.title}</h3>
              <p className="mt-1 text-sm text-ink/70">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What goes on the table */}
      <section className="py-8">
        <h2 className="text-center font-display text-2xl font-bold sm:text-3xl">
          What goes on the table
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-ink/70">
          SharePix prints you a fold-in-half table tent — {TENT_WIDTH_IN}&Prime; ×{' '}
          {TENT_HEIGHT_IN}&Prime;, two to a sheet of Letter paper. This is the front of one.
        </p>

        <div className="mt-8 flex justify-center">
          {/* A still of the tent's front panel, at a readable size. The real
              thing is generated per event at /event/[id]/table-tent. */}
          <div className="w-full max-w-sm sp-card p-6 text-center">
            <p className="font-display text-xl font-extrabold leading-tight">{tent.eventName}</p>
            {tent.dateLine ? <p className="mt-1 text-sm text-muted">{tent.dateLine}</p> : null}
            {tent.locationLine ? (
              <p className="text-sm text-muted">{tent.locationLine}</p>
            ) : null}
            <p className="mt-4 font-display text-lg font-bold">{tent.headline}</p>
            <div className="mt-3 flex justify-center">
              <QRCodeSVG value={tent.uploadUrl} size={148} />
            </div>
            <p className="mt-3 text-sm text-muted">{tent.message}</p>
            {tent.code ? (
              <p className="mt-4 text-xs uppercase tracking-widest text-muted">
                Event code {tent.code}
              </p>
            ) : null}
          </div>
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          That QR code works — it opens the sample gallery below.
        </p>
      </section>

      {/* Where to go next */}
      <section className="py-10">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/demo/gallery"
            className="group sp-card sp-card-interactive p-6 hover:border-accent/40"
          >
            <h3 className="font-display text-xl font-bold group-hover:text-accent">
              The gallery →
            </h3>
            <p className="mt-2 text-sm text-ink/70">
              What guests and the host see afterwards. Sort by uploader or by time, open a
              photo full size, and select a batch to download.
            </p>
          </Link>
          <Link
            href="/demo/live"
            className="group sp-card sp-card-interactive p-6 hover:border-accent/40"
          >
            <h3 className="font-display text-xl font-bold group-hover:text-accent">
              The live slideshow →
            </h3>
            <p className="mt-2 text-sm text-ink/70">
              A venue screen that cycles photos as they arrive, with the QR code in the corner
              so anyone watching can add theirs.
            </p>
          </Link>
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/create-event"
            className="sp-btn-primary"
          >
            Create your event
          </Link>
        </div>
      </section>
    </Layout>
  );
}
