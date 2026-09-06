import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { QRCodeSVG } from 'qrcode.react';
import { fetchEvent, fetchEventPhotoRecords, getPhotoDisplaySource } from '@/lib/api';
import { liveSlideshowAvailable } from '@/lib/pricing';
import { FallbackImage } from '@/components/FallbackMedia';
import { initialSource, type MediaSource } from '@/lib/mediaSource';
import {
  LIVE_BUFFER_SECONDS,
  POLL_INTERVAL_MS,
  SLIDE_DURATION_MS,
  URL_REFRESH_MS,
  newArrivals,
  nextIndex,
  slideshowEligible,
} from '@/lib/slideshow';
import { QREvent, QRPhoto } from '@/lib/types';

/** A photo plus where we resolved it from (R2 first, S3 behind), and when. */
interface Frame {
  photo: QRPhoto;
  source: MediaSource;
  signedAt: number;
}

/**
 * Live slideshow for a venue screen. Open this on a laptop/TV browser at the
 * reception and leave it running: it polls for new photos, holds each one for a
 * short moderation buffer, then cycles them full-screen — featuring brand-new
 * uploads as they arrive so guests see their photo appear.
 *
 * Built to survive a whole event unattended: signed URLs are re-resolved before
 * they expire, a failed poll keeps the current reel on screen instead of
 * blanking, and a wake lock stops the screen sleeping.
 */
export default function LiveSlideshowPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [fading, setFading] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const [photoCount, setPhotoCount] = useState(0);

  // Reel state lives in refs: the timers below read it without re-subscribing on
  // every render (which would restart the slideshow each tick).
  const reelRef = useRef<QRPhoto[]>([]);
  const queueRef = useRef<QRPhoto[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const indexRef = useRef(0);
  const urlCacheRef = useRef<Map<string, { source: MediaSource; signedAt: number }>>(new Map());

  const uploadUrl =
    typeof window !== 'undefined' && eventId
      ? `${window.location.origin}/event/${eventId}/upload`
      : '';

  /** Where to load a photo from, reusing a cached pair until it is near expiry. */
  const resolveSource = useCallback(async (photo: QRPhoto): Promise<MediaSource | null> => {
    const cached = urlCacheRef.current.get(photo.id);
    if (cached && Date.now() - cached.signedAt < URL_REFRESH_MS) return cached.source;
    try {
      const source = await getPhotoDisplaySource(photo);
      urlCacheRef.current.set(photo.id, { source, signedAt: Date.now() });
      return source;
    } catch {
      return cached?.source ?? null; // keep showing a stale URL rather than nothing
    }
  }, []);

  /** Poll for photos and fold any new arrivals into the reel. */
  const refresh = useCallback(async () => {
    if (!eventId) return;
    try {
      const records = await fetchEventPhotoRecords(eventId);
      const eligible = slideshowEligible(records);
      reelRef.current = eligible;
      setPhotoCount(eligible.length);
      // Anything not yet shown jumps the queue so it appears while the guest who
      // uploaded it is still nearby.
      const arrivals = newArrivals(eligible, seenRef.current);
      if (arrivals.length > 0) {
        const queued = new Set(queueRef.current.map((item) => item.id));
        queueRef.current.push(...arrivals.filter((item) => !queued.has(item.id)));
      }
    } catch {
      // A failed poll is not fatal — the reel we already have keeps playing.
    }
  }, [eventId]);

  /** Move to the next photo: queued arrivals first, then the normal cycle. */
  const advance = useCallback(async () => {
    const queued = queueRef.current.shift();
    let candidate: QRPhoto | undefined = queued;
    let flagAsNew = Boolean(queued);

    if (!candidate) {
      const reel = reelRef.current;
      if (reel.length === 0) return;
      indexRef.current = nextIndex(indexRef.current, reel.length);
      candidate = reel[indexRef.current];
    }
    if (!candidate) return;

    const source = await resolveSource(candidate);
    if (!source) return; // couldn't sign it; try again on the next tick

    seenRef.current.add(candidate.id);
    setFading(true);
    // Let the outgoing frame fade before swapping in the next one.
    window.setTimeout(() => {
      setFrame({ photo: candidate as QRPhoto, source, signedAt: Date.now() });
      setIsNew(flagAsNew);
      setFading(false);
    }, 400);
  }, [resolveSource]);

  // Initial load: event details, then the first fill of the reel.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const ev = await fetchEvent(eventId);
        if (cancelled) return;
        if (!ev) {
          setError('We couldn’t find that event.');
          return;
        }
        setEvent(ev);
        // The slideshow is included on Plus and Corporate, and sold as a
        // per-event add-on everywhere else. The venue screen is usually not
        // signed in, so the gate is the event's own row rather than the
        // viewer's identity.
        if (!liveSlideshowAvailable(ev)) {
          setError(
            'The live slideshow is not enabled for this event. The host can turn it on from their event dashboard.',
          );
          return;
        }
        await refresh();
        if (!cancelled) await advance();
      } catch {
        if (!cancelled) setError('The slideshow could not be started.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, refresh, advance]);

  // Poll for new photos.
  useEffect(() => {
    if (!eventId) return;
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [eventId, refresh]);

  // Advance the reel.
  useEffect(() => {
    if (!eventId) return;
    const id = window.setInterval(() => void advance(), SLIDE_DURATION_MS);
    return () => window.clearInterval(id);
  }, [eventId, advance]);

  // Keep the venue screen awake for the whole reception where supported.
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        sentinel = (await nav.wakeLock?.request('screen')) ?? null;
      } catch {
        // Not supported (or denied) — the screen may sleep; nothing else breaks.
      }
    };
    void request();
    // Browsers drop the lock when the tab is backgrounded; take it again.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  // Hide the on-screen controls once the room settles; any movement brings back.
  useEffect(() => {
    let timer = window.setTimeout(() => setShowChrome(false), 6000);
    const wake = () => {
      setShowChrome(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setShowChrome(false), 6000);
    };
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
    };
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  const waiting = !frame && !loading && !error;

  return (
    <>
      <Head>
        <title>{event ? `${event.name} — live` : 'Live slideshow'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
        {error ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="text-xl text-white/80">{error}</p>
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xl text-white/60">Starting the slideshow…</p>
          </div>
        ) : waiting ? (
          <div className="flex h-full flex-col items-center justify-center gap-8 px-8 text-center">
            <div>
              <h1 className="font-sans text-4xl font-bold tracking-[-0.02em] sm:text-6xl">
                {event?.name ?? 'Waiting for photos'}
              </h1>
              <p className="mt-4 text-xl text-white/70 sm:text-2xl">
                Scan to add the first photo — it appears here moments later.
              </p>
            </div>
            {uploadUrl ? (
              <div className="rounded-3xl bg-white p-6">
                <QRCodeSVG value={uploadUrl} size={280} />
              </div>
            ) : null}
            <p className="text-sm text-white/40">
              New photos appear about {LIVE_BUFFER_SECONDS} seconds after upload.
            </p>
          </div>
        ) : frame ? (
          <>
            {/* Blurred fill so portrait phone photos don't sit in empty black bars. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-2xl"
              // The blur is decorative, so it takes the first URL and doesn't
              // follow a fallback — a missing backdrop is invisible either way.
              style={{ backgroundImage: `url(${initialSource(frame.source)})` }}
            />
            <FallbackImage
              key={frame.photo.id}
              source={frame.source}
              alt=""
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-500 ${
                fading ? 'opacity-0' : 'opacity-100'
              }`}
            />

            {isNew ? (
              <div className="absolute left-1/2 top-8 -translate-x-1/2 rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-black shadow-lg">
                Just added
              </div>
            ) : null}

            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 bg-gradient-to-t from-black/70 to-transparent p-8">
              <div className="min-w-0">
                <p className="truncate text-2xl font-medium drop-shadow">
                  {frame.photo.uploadedBy || 'Anonymous'}
                </p>
                {event ? (
                  <p className="truncate text-sm text-white/60">{event.name}</p>
                ) : null}
              </div>
              {uploadUrl ? (
                <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-white/95 p-3 text-black">
                  <QRCodeSVG value={uploadUrl} size={84} />
                  <p className="max-w-[8rem] text-xs font-medium leading-snug">
                    Scan to add your photos
                  </p>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {/* Operator controls — fade out once the screen is left alone. */}
        <div
          className={`absolute right-6 top-6 flex items-center gap-2 transition-opacity duration-500 ${
            showChrome ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <span className="rounded-full bg-black/50 px-3 py-1.5 text-xs text-white/70">
            {photoCount} photo{photoCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium hover:bg-white/25"
          >
            Fullscreen
          </button>
        </div>
      </main>
    </>
  );
}
