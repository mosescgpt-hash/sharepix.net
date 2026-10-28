import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import BoothGuestUpload from '@/components/BoothGuestUpload';
import { uploadBoothGuestPhoto } from '@/lib/api';
import {
  captureSize,
  canvasToJpeg,
  createUploadQueue,
  personalPageUrl,
  type CaptureState,
} from '@/lib/boothCapture';

/** 48px+ touch targets; the Stop button is deliberately huge. */
const BIG = 'inline-flex min-h-[64px] w-full items-center justify-center px-6 text-xl font-bold';
const BTN = 'inline-flex min-h-[48px] items-center justify-center px-5 text-base font-semibold';

type Phase = 'intro' | 'live' | 'finishing' | 'done';
type Facing = 'environment' | 'user';

export interface BoothCaptureProps {
  galleryKey: string;
  eventName: string | null;
  attendeeName: string | null;
  /** Whether this guest may add photos now, and if not, the host's words. */
  uploadsOpen: boolean;
  uploadsMessage: string | null;
  sharedGalleryPath: string | null;
  sharedGalleryMessage: string | null;
}

/** Why the camera would not start, in words a guest can act on. */
export function cameraProblem(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The camera is blocked for this page. Allow camera access in your browser (iPhone: tap aA in the address bar, then Website Settings, then Camera. Android: tap the lock icon, then Permissions, then Camera), then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'The camera could not start in this browser.';
}

/**
 * Take as many photos as you like with a live camera until you tap Stop.
 *
 * The camera opens once and stays open: no picker, no restart per photo.
 * Every shot is shrunk to 2000 px on the phone (which drops location data)
 * and uploaded in the background to this guest, so all of the session ends up
 * on their personal page once the host approves each photo. Stop then shows
 * their personal QR. Without a usable camera, the plain photo picker still
 * works.
 */
export default function BoothCapture(props: BoothCaptureProps) {
  const { galleryKey } = props;
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const wake = useRef<{ release: () => Promise<void> } | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [facing, setFacing] = useState<Facing>('environment');
  const [problem, setProblem] = useState<string | null>(null);
  const [taken, setTaken] = useState(0);
  const [flash, setFlash] = useState(false);
  const [progress, setProgress] = useState<CaptureState>({ sent: 0, waiting: 0, failed: 0, stopped: null });
  const queue = useRef<ReturnType<typeof createUploadQueue> | null>(null);

  if (!queue.current) {
    queue.current = createUploadQueue({
      send: (image) => uploadBoothGuestPhoto(galleryKey, image),
      onChange: setProgress,
    });
  }

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    void wake.current?.release().catch(() => undefined);
    wake.current = null;
  }, []);

  const startCamera = useCallback(
    async (which: Facing) => {
      setProblem(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem('This browser can not open the camera here. Open the link in Safari or Chrome.');
        return false;
      }
      try {
        stopCamera();
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: which }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        });
        stream.current = s;
        setPhase('live');
        setFacing(which);
        // The <video> mounts with the live phase; attach on the next frame.
        requestAnimationFrame(() => {
          if (video.current) {
            video.current.srcObject = s;
            void video.current.play().catch(() => undefined);
          }
        });
        const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
        nav.wakeLock?.request('screen').then((l) => (wake.current = l)).catch(() => undefined);
        return true;
      } catch (err) {
        setProblem(cameraProblem(err));
        setPhase('intro');
        return false;
      }
    },
    [stopCamera],
  );

  // Release the camera when leaving the page.
  useEffect(() => stopCamera, [stopCamera]);

  // Coming back from another app: a paused preview should carry on.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && stream.current) void video.current?.play().catch(() => undefined);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  function shoot() {
    const v = video.current;
    const q = queue.current;
    if (!v || !q || !v.videoWidth || !q.canAdd()) return;
    const size = captureSize(v.videoWidth, v.videoHeight);
    const c = document.createElement('canvas');
    c.width = size.width;
    c.height = size.height;
    c.getContext('2d')?.drawImage(v, 0, 0, size.width, size.height);
    if (q.add(canvasToJpeg(c))) {
      setTaken((n) => n + 1);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 120);
      navigator.vibrate?.(25);
    }
  }

  async function stop() {
    stopCamera();
    setPhase('finishing');
    await queue.current?.idle();
    setPhase('done');
  }

  const q = queue.current;
  const canShoot = q.canAdd();

  if (!props.uploadsOpen) {
    return (
      <Shell>
        <Title {...props} />
        <p className="mt-4 text-base text-charcoal/85">{props.uploadsMessage ?? 'Photos can not be added right now.'}</p>
        <Link href={`/booth/photos/${encodeURIComponent(galleryKey)}`} className={`spx-btn-ink mt-6 ${BTN}`}>
          See my photos
        </Link>
      </Shell>
    );
  }

  if (phase === 'live') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
        <div className="relative min-h-0 flex-1">
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            aria-label="Camera"
            className="h-full w-full object-cover"
            style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined}
          />
          {flash ? <div className="pointer-events-none absolute inset-0 bg-white/70" /> : null}
          <p className="absolute left-3 top-3 bg-black/60 px-3 py-2 text-sm font-semibold" role="status">
            {taken} photo{taken === 1 ? '' : 's'} taken
            {progress.waiting > 0 ? ` · sending ${progress.waiting}` : taken > 0 ? ' · all sent' : ''}
          </p>
          {progress.stopped ? (
            <p className="absolute inset-x-3 top-14 bg-white p-3 text-sm font-medium text-charcoal" role="alert">
              {progress.stopped}
            </p>
          ) : progress.failed > 0 ? (
            <p className="absolute inset-x-3 top-14 bg-white p-3 text-sm font-medium text-charcoal" role="alert">
              {progress.failed} photo{progress.failed === 1 ? '' : 's'} waiting for a connection.{' '}
              <button type="button" className="underline" onClick={() => q.retryFailed()}>
                Try again
              </button>
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between bg-black px-4 pb-2 pt-3">
          <button
            type="button"
            onClick={() => void startCamera(facing === 'user' ? 'environment' : 'user')}
            className="min-h-[48px] min-w-[48px] border border-white/60 px-3 text-sm font-semibold"
          >
            Flip camera
          </button>
          <button
            type="button"
            onClick={shoot}
            disabled={!canShoot}
            aria-label="Take photo"
            className="h-[76px] w-[76px] rounded-full border-4 border-white bg-white/90 disabled:opacity-40"
          />
          <span className="min-w-[48px]" aria-hidden />
        </div>
        <div className="bg-black px-4 pb-5">
          <button type="button" onClick={() => void stop()} className={`${BIG} bg-mint text-ink`}>
            Stop
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'finishing') {
    return (
      <Shell>
        <Title {...props} />
        <p className="mt-6 text-lg font-semibold" role="status">
          Sending your last photos&hellip; {progress.waiting > 0 ? `${progress.waiting} to go` : ''}
        </p>
      </Shell>
    );
  }

  if (phase === 'done') {
    const origin = typeof window === 'undefined' ? 'https://www.sharepix.net' : window.location.origin;
    const mine = personalPageUrl(origin, galleryKey);
    return (
      <Shell>
        <Title {...props} />
        <h2 className="mt-5 text-2xl font-bold">
          {progress.sent === 0 ? 'No photos were sent' : `${progress.sent} photo${progress.sent === 1 ? '' : 's'} sent`}
        </h2>
        <p className="mt-2 text-base text-charcoal/85">
          They are all on your personal page together. Each one shows there once the host approves it.
        </p>
        {progress.stopped ? <p className="mt-3 text-sm font-medium" role="alert">{progress.stopped}</p> : null}
        {progress.failed > 0 && !progress.stopped ? (
          <p className="mt-3 text-sm font-medium" role="alert">
            {progress.failed} photo{progress.failed === 1 ? '' : 's'} did not send (no connection).{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                q.retryFailed();
                setPhase('finishing');
                void q.idle().then(() => setPhase('done'));
              }}
            >
              Try again
            </button>
          </p>
        ) : null}
        <div className="mx-auto mt-5 w-fit bg-white p-3">
          <QRCodeSVG value={mine} size={176} level="M" includeMargin aria-label="Your personal photo page QR code" />
        </div>
        <p className="mt-2 text-center text-sm text-charcoal/75">Your personal QR. Scan it to open your photos on any phone.</p>
        <div className="mt-5 flex flex-col gap-3">
          <Link href={`/booth/photos/${encodeURIComponent(galleryKey)}`} className={`spx-btn-ink ${BTN}`}>
            See my photos
          </Link>
          {props.sharedGalleryPath ? (
            <Link href={props.sharedGalleryPath} className={`spx-btn-outline ${BTN}`}>
              See the event&rsquo;s shared gallery
            </Link>
          ) : null}
          {!progress.stopped ? (
            <button
              type="button"
              className={`border border-charcoal/30 ${BTN}`}
              onClick={() => {
                setTaken(0);
                void startCamera(facing);
              }}
            >
              Take more photos
            </button>
          ) : null}
        </div>
        {props.sharedGalleryMessage ? <p className="mt-3 text-sm text-charcoal/65">{props.sharedGalleryMessage}</p> : null}
      </Shell>
    );
  }

  return (
    <Shell>
      <Title {...props} />
      <p className="mt-4 text-base text-charcoal/85">
        Take as many photos as you like. The camera stays open, so there is nothing to restart. Tap{' '}
        <strong>Stop</strong> when you are done and all of them go to your personal page. The host approves each photo
        before it appears there.
      </p>
      <button type="button" onClick={() => void startCamera(facing)} className={`spx-btn-ink mt-6 ${BIG}`}>
        Start camera
      </button>
      {problem ? (
        <div className="mt-4 border border-charcoal/20 bg-white p-4" role="alert">
          <p className="text-sm">{problem}</p>
          <p className="mt-2 text-sm text-charcoal/75">You can still add photos from your camera app or photo library:</p>
          <BoothGuestUpload galleryKey={galleryKey} open message={null} left={1000} />
        </div>
      ) : null}
      <Link
        href={`/booth/photos/${encodeURIComponent(galleryKey)}`}
        className={`mt-4 w-full border border-charcoal/30 ${BTN}`}
      >
        See my photos
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-canvas px-5 py-8 text-charcoal">{children}</main>
  );
}

function Title({ eventName, attendeeName }: Pick<BoothCaptureProps, 'eventName' | 'attendeeName'>) {
  return (
    <header>
      {eventName ? <p className="spx-eyebrow">{eventName}</p> : null}
      <h1 className="spx-display mt-1 text-3xl">{attendeeName ? `${attendeeName}, take photos` : 'Take photos'}</h1>
    </header>
  );
}
