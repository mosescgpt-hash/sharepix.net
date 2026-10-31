import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { QRCodeSVG } from 'qrcode.react';
import {
  fetchEvent,
  fetchEventPhotoRecords,
  getCurrentUserInfo,
  getPhotoDisplaySource,
} from '@/lib/api';
import GalleryAccessNotice from '@/components/GalleryAccessNotice';
import { useGuestLinkKey } from '@/lib/useGuestLinkKey';
import { isGlobalAdmin } from '@/lib/admin';
import { isEventHost } from '@/lib/gallery';
import { galleryAudienceFor } from '@/lib/galleryAudience';
import {
  captureLinkKey,
  guestLinkPath,
  isLinkRequiredError,
  isSharingPausedError,
} from '@/lib/galleryAccess';
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
import { isVideoFilename } from '@/lib/validation';
import { withTimeout, withTimeoutOr } from '@/lib/withTimeout';
import {
  classifyLiveError,
  connectionMessage,
  emptyReelReason,
  fullscreenSupport,
  isFullscreenNow,
  toggleNativeFullscreen,
  type FullscreenSupport,
  type LiveProblem,
} from '@/lib/liveView';
import ChallengeCaption from '@/components/challenges/ChallengeCaption';
import { challengeCaption } from '@/lib/challenges/rules';
import { useEventChallenges } from '@/lib/challenges/useEventChallenges';

/** How long a photo whose image failed is passed over before it is tried again. */
const BAD_PHOTO_SKIP_MS = 60_000;
/** The pause before moving on from a picture that would not load. */
const IMAGE_FAILED_RETRY_MS = 1_500;

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
  // Why the reel is empty although photos exist: still inside the moderation
  // buffer, or only videos (the slideshow shows still photos).
  const [emptyReason, setEmptyReason] = useState<'none' | 'buffer' | 'videos-only'>('none');
  // Set after two polls in a row fail for a reason other than a gate, so a
  // viewer is told rather than left on "Waiting for photos". Cleared by the
  // next poll that works.
  const [problem, setProblem] = useState<LiveProblem | null>(null);
  // Photos exist but none could be signed for display (so nothing can be shown).
  const [loadTrouble, setLoadTrouble] = useState(false);
  // Bumped by the Try again button to restart the start-up sequence.
  const [attempt, setAttempt] = useState(0);
  // Fullscreen: real fullscreen where the browser has it, otherwise (iPhone
  // Safari) a "fill the screen" mode that hides the page chrome.
  const [fsSupport, setFsSupport] = useState<FullscreenSupport>('native');
  const [isFs, setIsFs] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [fsHint, setFsHint] = useState(false);
  // A start-up failure that may clear on its own (slow network, session), as
  // opposed to "event not found" or "slideshow not enabled".
  const [startFailed, setStartFailed] = useState(false);
  // Why this screen has nothing to show: the host paused sharing, or the link
  // it was opened from was replaced. Cleared by the next poll that succeeds, so
  // a screen left running picks up again when the host resumes.
  const [gate, setGate] = useState<'paused' | 'replaced' | null>(null);
  // The host (or an admin) is watching, so the server will not turn them away.
  const [hostView, setHostView] = useState(false);
  const { key: linkKey } = useGuestLinkKey(eventId, hostView);
  // Photo challenges, for the caption under a challenge photo. [] unless the
  // host turned challenges on.
  const challenges = useEventChallenges(event);

  // Reel state lives in refs: the timers below read it without re-subscribing on
  // every render (which would restart the slideshow each tick).
  const reelRef = useRef<QRPhoto[]>([]);
  const queueRef = useRef<QRPhoto[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const indexRef = useRef(0);
  const urlCacheRef = useRef<Map<string, { source: MediaSource; signedAt: number }>>(new Map());
  const failedPollsRef = useRef(0);
  const frameShownRef = useRef(false);
  // Photos whose image would not load on this device, and when. They are passed
  // over for a while (then tried again with a fresh URL) instead of freezing the
  // screen on a broken picture.
  const badPhotosRef = useRef<Map<string, number>>(new Map());
  // Whether any image has actually painted yet. Until one has, a failed image
  // is shown as "could not be loaded" rather than as a broken frame.
  const imagePaintedRef = useRef(false);

  const uploadUrl =
    typeof window !== 'undefined' && eventId
      ? `${window.location.origin}${guestLinkPath(eventId, linkKey, 'upload')}`
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
      const records = await withTimeout(fetchEventPhotoRecords(eventId), 20_000, 'Timed out loading photos');
      setGate(null);
      failedPollsRef.current = 0;
      setProblem(null);
      const eligible = slideshowEligible(records);
      reelRef.current = eligible;
      setPhotoCount(eligible.length);
      setEmptyReason(
        emptyReelReason(
          records.length,
          eligible.length,
          records.filter((photo) => isVideoFilename(photo.s3Key)).length,
        ),
      );
      // Anything not yet shown jumps the queue so it appears while the guest who
      // uploaded it is still nearby.
      const arrivals = newArrivals(eligible, seenRef.current);
      if (arrivals.length > 0) {
        const queued = new Set(queueRef.current.map((item) => item.id));
        queueRef.current.push(...arrivals.filter((item) => !queued.has(item.id)));
      }
    } catch (err) {
      // Sharing was paused, or the QR code replaced, while the screen was running.
      if (isSharingPausedError(err)) setGate('paused');
      else if (isLinkRequiredError(err)) setGate('replaced');
      else {
        // Any other failed poll is not fatal — the reel we already have keeps
        // playing. But after two in a row, with nothing on screen, say so: a
        // phone that cannot get a guest session would otherwise sit on
        // "Waiting for photos" for the whole event.
        failedPollsRef.current += 1;
        if (failedPollsRef.current >= 2) setProblem(classifyLiveError(err));
      }
    }
  }, [eventId]);

  /**
   * Move to the next photo: queued arrivals first, then the normal cycle.
   *
   * A photo that cannot be signed is skipped for the next one (up to three per
   * tick) rather than ending the tick, so one bad file cannot freeze the screen.
   * When nothing at all could be loaded, `loadTrouble` says so.
   */
  const advance = useCallback(async () => {
    for (let tries = 0; tries < 3; tries += 1) {
      const queued = queueRef.current.shift();
      let candidate: QRPhoto | undefined = queued;
      const flagAsNew = Boolean(queued);

      if (!candidate) {
        const reel = reelRef.current;
        if (reel.length === 0) return;
        indexRef.current = nextIndex(indexRef.current, reel.length);
        candidate = reel[indexRef.current];
      }
      if (!candidate) return;

      // Passed over: this one failed to load on this device a moment ago.
      const failedAt = badPhotosRef.current.get(candidate.id);
      if (failedAt && Date.now() - failedAt < BAD_PHOTO_SKIP_MS) {
        if (!frameShownRef.current) setLoadTrouble(true);
        continue;
      }

      const source = await resolveSource(candidate);
      if (!source) {
        // Couldn't sign it: try the next one. Only claim trouble when there is
        // still nothing on screen to fall back on.
        if (!frameShownRef.current) setLoadTrouble(true);
        continue;
      }

      setLoadTrouble(false);
      frameShownRef.current = true;
      seenRef.current.add(candidate.id);
      setFading(true);
      const chosen = candidate;
      // Let the outgoing frame fade before swapping in the next one.
      window.setTimeout(() => {
        setFrame({ photo: chosen, source, signedAt: Date.now() });
        setIsNew(flagAsNew);
        setFading(false);
      }, 400);
      return;
    }
  }, [resolveSource]);

  /**
   * The picture on screen would not load from any of its URLs. Forget the URL
   * (so the next try signs a fresh one), skip the photo for a while, and move on
   * after a short pause — never straight away, so a device where every image
   * fails cannot spin.
   */
  const handleImageFailed = useCallback(
    (photo: QRPhoto) => {
      urlCacheRef.current.delete(photo.id);
      badPhotosRef.current.set(photo.id, Date.now());
      if (!imagePaintedRef.current) {
        // Nothing has ever shown: say so, instead of leaving a broken picture.
        frameShownRef.current = false;
        setFrame(null);
        setLoadTrouble(true);
      }
      window.setTimeout(() => void advance(), IMAGE_FAILED_RETRY_MS);
    },
    [advance],
  );

  // Initial load: event details, then the first fill of the reel.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setStartFailed(false);
      try {
        const ev = await withTimeout(fetchEvent(eventId), 20_000, 'Timed out loading the event');
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

        // Who may watch. The server refuses everything it should (this only
        // decides what to show), and a host who is signed in as themselves
        // always sees their own event.
        // Neither check may hold a guest's phone on "Starting…": the admin check
        // refreshes the session over the network, which can stall on a weak
        // connection. A timeout reads as "not the host / not an admin", which is
        // the safe answer, and the server decides access either way.
        const [user, admin] = await Promise.all([
          withTimeoutOr(getCurrentUserInfo(), 8_000, null),
          withTimeoutOr(isGlobalAdmin().catch(() => false), 8_000, false),
        ]);
        const privileged = isEventHost(ev, user) || admin;
        if (!privileged && (ev.guestViewBlocked === true || galleryAudienceFor(ev) === 'host')) {
          setError(
            'The live slideshow is off because the host is keeping this gallery to themselves. The host can open it while signed in, or allow guests to view the gallery.',
          );
          return;
        }
        setHostView(privileged);
        // A screen link made after the QR code was replaced carries its key
        // after the #. It stays in the address bar, so a venue screen that is
        // reloaded in the middle of the night still opens.
        if (!privileged) captureLinkKey(eventId);
        await refresh();
        if (!cancelled) await advance();
      } catch (err) {
        if (!cancelled) {
          const kind = classifyLiveError(err);
          setStartFailed(true);
          setError(
            kind === 'timeout' || kind === 'network' || kind === 'session'
              ? connectionMessage(kind)
              : 'The slideshow could not be started.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, refresh, advance, attempt]);

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
    window.addEventListener('pointerdown', wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, []);

  // Fit the screen on a phone. The page is a fixed layer the size of what is
  // actually visible (not 100vh, which on iPhone Safari is taller than the
  // visible area and made the page scroll), and the document behind it cannot
  // scroll.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = { html: html.style.overflow, body: body.style.overflow, overscroll: html.style.overscrollBehavior };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    return () => {
      html.style.overflow = prev.html;
      body.style.overflow = prev.body;
      html.style.overscrollBehavior = prev.overscroll;
    };
  }, []);

  // Which kind of fullscreen this browser has, and keep the button honest when
  // the person leaves it with Esc or a swipe.
  useEffect(() => {
    setFsSupport(fullscreenSupport(document));
    const sync = () => setIsFs(isFullscreenNow(document));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  async function toggleFullscreen() {
    if (fsSupport === 'none') {
      // iPhone Safari: no fullscreen API. Hide everything but the photo, and
      // tell the person how to get the browser bar out of the way.
      setImmersive((on) => !on);
      setFsHint(true);
      window.setTimeout(() => setFsHint(false), 8000);
      return;
    }
    const ok = await toggleNativeFullscreen(document);
    if (!ok) {
      setImmersive((on) => !on);
      setFsHint(true);
      window.setTimeout(() => setFsHint(false), 8000);
    }
  }

  const waiting = !frame && !loading && !error;
  const exitLabel = fsSupport !== 'none' && isFs ? 'Exit full screen' : immersive ? 'Exit full screen' : 'Full screen';

  return (
    <>
      <Head>
        <title>{event ? `${event.name} — live` : 'Live slideshow'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main
        className="fixed inset-0 overflow-hidden bg-black text-white"
        // dvh where the browser has it; `fixed inset-0` above already tracks the
        // visible area everywhere else.
        style={{ height: '100dvh', width: '100vw' }}
      >
        {/* Passive branding only — no link. This is a TV screen nobody is
            touching, not a page somebody can tap; see components/GuestReferralLink.tsx
            for the clickable version of this same guest-to-host loop. */}
        <p
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 text-xs font-medium tracking-wide text-white/60"
        >
          sharepix.net
        </p>
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
            <p className="text-xl text-white/80">{error}</p>
            {startFailed ? (
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : gate ? (
          <div className="flex h-full items-center justify-center px-6">
            <GalleryAccessNotice dark what="the slideshow" reason={gate} />
          </div>
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xl text-white/60">Starting the slideshow…</p>
          </div>
        ) : waiting ? (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center sm:gap-8 sm:px-8">
            <div>
              <h1 className="font-sans text-3xl font-bold tracking-[-0.02em] sm:text-6xl">
                {event?.name ?? 'Waiting for photos'}
              </h1>
              {problem ? (
                <p className="mt-4 text-base text-amber-200 sm:text-2xl" role="status">
                  {connectionMessage(problem)}
                </p>
              ) : loadTrouble ? (
                <p className="mt-4 text-base text-amber-200 sm:text-2xl" role="status">
                  Photos were found but could not be loaded yet. Retrying…
                </p>
              ) : emptyReason === 'buffer' ? (
                <p className="mt-4 text-base text-white/70 sm:text-2xl">
                  Photos are on their way — each one appears about {LIVE_BUFFER_SECONDS} seconds
                  after upload.
                </p>
              ) : emptyReason === 'videos-only' ? (
                <p className="mt-4 text-base text-white/70 sm:text-2xl">
                  Only videos have been added so far. The live slideshow shows photos, so videos
                  stay in the gallery.
                </p>
              ) : (
                <p className="mt-4 text-base text-white/70 sm:text-2xl">
                  Scan to add the first photo — it appears here moments later.
                </p>
              )}
            </div>
            {uploadUrl && !problem ? (
              <div className="rounded-3xl bg-white p-4 sm:p-6">
                <QRCodeSVG
                  value={uploadUrl}
                  size={280}
                  style={{ width: 'min(60vw, 32dvh, 280px)', height: 'auto' }}
                />
              </div>
            ) : null}
            {problem || loadTrouble ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black"
              >
                Reload
              </button>
            ) : (
              <p className="text-sm text-white/40">
                New photos appear about {LIVE_BUFFER_SECONDS} seconds after upload.
              </p>
            )}
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
              onLoad={() => {
                imagePaintedRef.current = true;
              }}
              onFailed={() => handleImageFailed(frame.photo)}
              className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-500 ${
                fading ? 'opacity-0' : 'opacity-100'
              }`}
            />

            {isNew ? (
              <div className="absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] -translate-x-1/2 sm:top-8 rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-black shadow-lg">
                Just added
              </div>
            ) : null}

            <div
              className={`absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-black/70 to-transparent p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-6 sm:p-8 ${
                immersive ? 'hidden' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-lg font-medium drop-shadow sm:text-2xl">
                  {frame.photo.uploadedBy || 'Anonymous'}
                </p>
                <ChallengeCaption
                  text={challengeCaption(frame.photo, challenges, event?.challengeCaptions)}
                />
                {event ? (
                  <p className="truncate text-sm text-white/60">{event.name}</p>
                ) : null}
              </div>
              {uploadUrl ? (
                <div className="flex shrink-0 items-center gap-2 rounded-2xl bg-white/95 p-2 text-black sm:gap-3 sm:p-3">
                  <QRCodeSVG value={uploadUrl} size={84} className="h-14 w-14 sm:h-[84px] sm:w-[84px]" />
                  <p className="hidden max-w-[8rem] text-xs font-medium leading-snug sm:block">
                    Scan to add your photos
                  </p>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {/* Connection trouble while a photo is on screen: small, and clears itself. */}
        {frame && problem ? (
          <p
            role="status"
            className="absolute left-1/2 top-14 -translate-x-1/2 rounded-full bg-amber-500/90 px-4 py-1.5 text-xs font-medium text-black"
          >
            Reconnecting…
          </p>
        ) : null}

        {fsHint ? (
          <p
            role="status"
            className="absolute inset-x-4 bottom-24 rounded-2xl bg-black/80 px-4 py-3 text-center text-sm text-white"
          >
            {immersive
              ? 'Tap the screen to bring the buttons back. For no browser bar at all, use Share, then Add to Home Screen, and open it from there.'
              : 'Full screen is off.'}
          </p>
        ) : null}

        {/* Operator controls — fade out once the screen is left alone. In the
            fill-the-screen mode the exit button stays reachable on any tap. */}
        <div
          className={`absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-2 transition-opacity duration-500 sm:right-6 sm:top-6 ${
            showChrome ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <span className="rounded-full bg-black/50 px-3 py-1.5 text-xs text-white/70">
            {photoCount} photo{photoCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="rounded-full bg-white/25 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/35"
          >
            {exitLabel}
          </button>
        </div>
      </main>
    </>
  );
}
