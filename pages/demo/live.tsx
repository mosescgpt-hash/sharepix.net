import { useEffect, useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { QRCodeSVG } from 'qrcode.react';
import { DEMO_EVENT, DEMO_PHOTOS, DEMO_SLIDE_MS, nextSlide } from '@/lib/demoEvent';

/**
 * The sample live slideshow — what goes on a screen at the venue.
 *
 * Full-bleed and outside the normal Layout, exactly like the real
 * /event/[eventId]/live, because that is the thing being shown. It cycles the
 * demo photos on a timer instead of polling for new uploads; there is nothing
 * to poll.
 *
 * The "Just added" badge appears on the first pass only. On a real slideshow it
 * marks a photo that arrived while guests were watching, which is the moment
 * the feature exists for — worth showing, but not worth faking twice.
 */
export default function DemoLivePage() {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0]));

  useEffect(() => {
    const id = window.setInterval(() => {
      setFading(true);
      window.setTimeout(() => {
        setIndex((current) => {
          const next = nextSlide(current, DEMO_PHOTOS.length);
          setSeen((previous) => new Set(previous).add(next));
          return next;
        });
        setFading(false);
      }, 400);
    }, DEMO_SLIDE_MS);
    return () => window.clearInterval(id);
  }, []);

  const photo = DEMO_PHOTOS[index];
  // First time round only — see the note above.
  const isNew = !seen.has(nextSlide(index, DEMO_PHOTOS.length));

  return (
    <>
      <Head>
        <title>Sample live slideshow · SharePix</title>
      </Head>
      <main className="relative flex h-screen w-screen flex-col overflow-hidden bg-black text-white">
        <div className="relative flex-1">
          {/* Blurred fill so portrait phone photos don't sit in empty black bars. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-2xl"
            style={{ backgroundImage: `url(${photo.url})` }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={photo.id}
            src={photo.url}
            alt=""
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-500 ${
              fading ? 'opacity-0' : 'opacity-100'
            }`}
          />

          {isNew ? (
            <div className="absolute left-1/2 top-8 -translate-x-1/2 bg-canvas/95 px-5 py-2 text-sm font-semibold text-charcoal shadow-lg">
              Just added
            </div>
          ) : null}

          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 bg-gradient-to-t from-black/70 to-transparent p-8">
            <div className="min-w-0">
              <p className="truncate text-2xl font-medium drop-shadow">{photo.uploadedBy}</p>
              <p className="truncate text-sm text-white/60">{DEMO_EVENT.name}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 bg-canvas/95 p-3 text-charcoal">
              <QRCodeSVG value="https://www.sharepix.net/demo/gallery" size={84} />
              <p className="max-w-[8rem] text-xs font-medium leading-snug">
                Scan to add your photos
              </p>
            </div>
          </div>
        </div>

        {/* The one thing the real slideshow does not have: a way back out.
            A venue screen is meant to run untouched; a demo is meant to be left. */}
        <div className="flex shrink-0 items-center justify-between gap-4 bg-black px-6 py-3 text-sm">
          <p className="text-white/50">
            Sample slideshow · illustrations, not photographs · advances every{' '}
            {Math.round(DEMO_SLIDE_MS / 1000)}s
          </p>
          <div className="flex shrink-0 gap-3">
            <Link href="/demo" className="text-white/70 underline hover:text-white">
              Back to the example
            </Link>
            <Link href="/create-event" className="font-medium text-white underline">
              Create your event
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
