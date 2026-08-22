import { useState } from 'react';
import Link from 'next/link';
import { QREvent } from '@/lib/types';
import { hostGuideSections } from '@/lib/hostGuide';

/**
 * A collapsible quick-start on the host dashboard: how guests upload, how to
 * print the brochure, and — once bought — how to run the live slideshow and let
 * guests download. Contextual to this event, so the links actually work and the
 * paid sections only appear when the host owns them.
 */
export default function HostGuide({
  event,
  onShowQR,
}: {
  event: QREvent;
  onShowQR?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sections = hostGuideSections(event);

  return (
    <div className="mt-6 rounded-2xl border border-ink/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <span>
          <span className="font-display text-xl font-bold">How to run your event</span>
          <span className="mt-0.5 block text-sm text-ink/60">
            Sharing with guests, the printable brochure{sections.includes('live') ? ', the live slideshow' : ''}
            {sections.includes('downloads') ? ', guest downloads' : ''}.
          </span>
        </span>
        <span className="shrink-0 text-ink/50">{open ? '▲' : '▼'}</span>
      </button>

      {open ? (
        <div className="space-y-6 border-t border-ink/10 p-5 text-sm leading-6 text-ink/75">
          {/* 1 — Guests upload */}
          <section>
            <h3 className="font-display text-base font-bold text-ink">1. Get guests adding photos</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Show your QR code —{' '}
                {onShowQR ? (
                  <button type="button" onClick={onShowQR} className="font-medium text-accent hover:underline">
                    open it here
                  </button>
                ) : (
                  'use the “Show QR code” button above'
                )}{' '}
                — or print the brochure below for the tables.
              </li>
              <li>
                Guests point their phone camera at the code and open the link. No app, no sign-up.
              </li>
              <li>
                They can also go to sharepix.net and type your event code:{' '}
                <strong className="text-ink">{event.eventCode}</strong>.
              </li>
            </ol>
            <p className="mt-2 text-ink/60">
              Tell guests to keep the page open while photos upload — a phone can’t upload while
              it’s locked or on another app.
            </p>
          </section>

          {/* 2 — Brochure */}
          <section>
            <h3 className="font-display text-base font-bold text-ink">2. Print the table brochure</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Open the{' '}
                <Link
                  href={`/event/${event.id}/brochure`}
                  target="_blank"
                  className="font-medium text-accent hover:underline"
                >
                  printable brochure
                </Link>{' '}
                — it opens in a new tab with your QR code and short instructions already on it.
              </li>
              <li>Use your browser’s Print (or “Save as PDF”) — on a phone it’s in the share menu.</li>
              <li>Place one on each table, or by the entrance, so guests can join at any point.</li>
            </ol>
          </section>

          {/* 3 — Live slideshow (only when purchased) */}
          {sections.includes('live') ? (
            <section>
              <h3 className="font-display text-base font-bold text-ink">3. Run the live slideshow</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>On the computer driving the venue screen or projector, sign in and open this dashboard.</li>
                <li>
                  Open the{' '}
                  <Link
                    href={`/event/${event.id}/live`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-accent hover:underline"
                  >
                    live slideshow
                  </Link>{' '}
                  — it opens in its own tab.
                </li>
                <li>Put that tab full screen and leave it running. New photos appear on their own.</li>
              </ol>
              <p className="mt-2 text-ink/60">
                Photos wait about 90 seconds before appearing — that’s the screening buffer, so
                nothing hits the big screen the instant it lands. Set the computer not to sleep.
              </p>
            </section>
          ) : null}

          {/* Guest downloads (only when purchased) */}
          {sections.includes('downloads') ? (
            <section>
              <h3 className="font-display text-base font-bold text-ink">
                {sections.includes('live') ? '4' : '3'}. Let guests download
              </h3>
              <p className="mt-2">
                Guest downloads are on. Guests now get download buttons in the gallery, and you can
                build a download QR code for a chosen set of photos from the settings below.
              </p>
            </section>
          ) : null}

          <p className="border-t border-ink/10 pt-4 text-ink/60">
            More detail is in the{' '}
            <Link href="/help" className="font-medium text-accent hover:underline">
              help centre
            </Link>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}
