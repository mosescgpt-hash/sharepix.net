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

const NEXT_STOPS = [
  {
    href: '/demo/gallery',
    title: 'The gallery',
    body: 'What guests and the host see afterwards. Sort by uploader or by time, open a photo full size, and select a batch to download.',
  },
  {
    href: '/demo/live',
    title: 'The live slideshow',
    body: 'A venue screen that cycles photos as they arrive, with the QR code in the corner so anyone watching can add theirs.',
  },
  {
    href: '/demo/guestbook',
    title: 'The guest book',
    body: 'Signed notes guests leave alongside their photos — a message, a picture, or a short video message.',
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
    <Layout title="See how it works" width="bleed">
      <section className="spx-section-canvas">
        <div className="spx-inner">
          <p className="spx-eyebrow">A worked example</p>
          <h1 className="mt-3">
            <span className="spx-display block">This is what</span>
            <span className="spx-display-serif block">your guests will see.</span>
          </h1>
          <p className="spx-body mt-5 max-w-lg">
            A pretend wedding, set up exactly the way a real one would be. Have a look around —
            nothing here is live, and nothing you do can break it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo/try" className="spx-btn-ink">
              Try it with your own photo
            </Link>
            <Link href="/demo/gallery" className="spx-btn-outline">
              Open the sample gallery
            </Link>
          </div>
        </div>
      </section>

      <section className="spx-section-ink">
        <div className="spx-inner">
          <p className="spx-eyebrow">What you set up</p>
          <h2 className="mt-3">
            <span className="spx-display block">Four steps,</span>
            <span className="spx-display-serif block">then you are done.</span>
          </h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {SETUP_STEPS.map((step, i) => (
              <div key={step.title}>
                <div className="spx-step-icon bg-canvas/15 text-canvas">
                  <span className="spx-numeral text-lg">{`0${i + 1}`}</span>
                </div>
                <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                <p className="spx-body mt-2 text-sm">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="spx-section-sand">
        <div className="spx-inner">
          <p className="spx-eyebrow">What goes on the table</p>
          <h2 className="mt-3">
            <span className="spx-display block">One card.</span>
            <span className="spx-display-serif block">Every guest, invited.</span>
          </h2>
          <p className="spx-body mt-5 max-w-lg">
            SharePix prints you a fold-in-half table tent — {TENT_WIDTH_IN}&Prime; &times;{' '}
            {TENT_HEIGHT_IN}&Prime;, two to a sheet of Letter paper. This is the front of one.
          </p>

          <div className="mt-10 flex justify-center">
            {/* A still of the tent's front panel, at a readable size. The real
                thing is generated per event at /event/[id]/table-tent. */}
            <div className="spx-card w-full max-w-sm p-7 text-center">
              <p className="font-sans text-xl font-bold leading-tight tracking-[-0.02em]">
                {tent.eventName}
              </p>
              {tent.dateLine ? (
                <p className="mt-1 text-sm text-charcoal/55">{tent.dateLine}</p>
              ) : null}
              {tent.locationLine ? (
                <p className="text-sm text-charcoal/55">{tent.locationLine}</p>
              ) : null}
              <p className="mt-5 font-serif text-xl italic">{tent.headline}</p>
              <div className="mt-4 flex justify-center">
                <QRCodeSVG value={tent.uploadUrl} size={148} />
              </div>
              <p className="mt-4 text-sm text-charcoal/60">{tent.message}</p>
              {tent.code ? (
                <p className="mt-5 text-xs uppercase tracking-[0.18em] text-charcoal/50">
                  Event code {tent.code}
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-5 text-center text-sm text-charcoal/55">
            That QR code works — it opens the sample gallery.
          </p>
        </div>
      </section>

      <section className="spx-section-canvas">
        <div className="spx-inner">
          <p className="spx-eyebrow">Where to next</p>
          <h2 className="mt-3">
            <span className="spx-display block">Three more rooms</span>
            <span className="spx-display-serif block">to walk through.</span>
          </h2>
          {/* The guest book card used to sit inside the row of buttons at the
              top, where it was the only card among four links and broke the
              row on narrow screens. It belongs here with its siblings. */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NEXT_STOPS.map((stop) => (
              <Link
                key={stop.href}
                href={stop.href}
                className="spx-card group p-6 transition hover:border-charcoal/30"
              >
                <h3 className="font-sans text-lg font-semibold text-charcoal">
                  {stop.title} <span aria-hidden>&rarr;</span>
                </h3>
                <p className="spx-body mt-2 text-sm">{stop.body}</p>
              </Link>
            ))}
          </div>

          <div className="mt-12">
            <Link href="/create-event" className="spx-btn-ink">
              Create your event
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
