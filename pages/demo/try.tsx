import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import PhotoGrid from '@/components/PhotoGrid';
import {
  DEMO_STEPS,
  DEMO_STEP_COPY,
  type DemoStep,
  checkDemoFile,
  nextStep,
  stepNumber,
  visitorPhotoVisible,
} from '@/lib/demoFlow';
import { DEMO_EVENT, DEMO_PHOTOS, DEMO_SLIDE_MS, nextSlide } from '@/lib/demoEvent';
import type { DisplayPhoto } from '@/lib/types';

const VISITOR_PHOTO_ID = 'demo-your-photo';

function RoleBadge({ role }: { role: 'guest' | 'host' }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
        role === 'host' ? 'bg-ink text-white' : 'bg-accent/10 text-accent'
      }`}
    >
      {role === 'host' ? 'You are the host' : 'You are a guest'}
    </span>
  );
}

/** A framed slideshow for the last step. The full-screen one is /demo/live. */
function MiniSlideshow({ photos }: { photos: DisplayPhoto[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (photos.length < 2) return;
    const id = window.setInterval(
      () => setIndex((current) => nextSlide(current, photos.length)),
      DEMO_SLIDE_MS,
    );
    return () => window.clearInterval(id);
  }, [photos.length]);

  const photo = photos[Math.min(index, photos.length - 1)];
  if (!photo) return null;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
      <div
        aria-hidden
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-30 blur-2xl"
        style={{ backgroundImage: `url(${photo.url})` }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={photo.id}
        src={photo.url}
        alt=""
        className="absolute inset-0 h-full w-full object-contain"
      />
      {photo.id === VISITOR_PHOTO_ID ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-xs font-semibold text-black shadow-lg">
          Just added
        </div>
      ) : null}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white">
        <p className="text-sm font-medium">{DEMO_EVENT.name}</p>
        <p className="text-xs text-white/70">
          {photo.uploadedBy ? `Added by ${photo.uploadedBy}` : 'Added by you'}
        </p>
      </div>
    </div>
  );
}

export default function DemoTryPage() {
  const [step, setStep] = useState<DemoStep>('add');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The object URL is the only thing holding the visitor's photo. Revoke it
  // when it is replaced or the page goes away, so the bytes are released
  // rather than lingering for the life of the tab.
  const urlRef = useRef<string | null>(null);
  const setPhoto = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPhotoUrl(url);
  }, []);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function handleFile(changeEvent: ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0];
    // Let the same file be chosen twice in a row.
    changeEvent.target.value = '';
    if (!file) return;

    const check = checkDemoFile(file);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setError(null);
    setPhoto(URL.createObjectURL(file));
    setStep('held');
  }

  /** Their photo, shaped like a real one so PhotoGrid renders it normally. */
  const visitorPhoto: DisplayPhoto | null = useMemo(() => {
    if (!photoUrl) return null;
    return {
      id: VISITOR_PHOTO_ID,
      eventId: DEMO_EVENT.id,
      // A plausible key so anything that parses keys (video detection, sorting)
      // behaves the way it would for a real upload.
      s3Key: `events/${DEMO_EVENT.id}/photos/your-photo.jpg`,
      uploadedBy: 'You',
      approved: true,
      url: photoUrl,
      createdAt: new Date().toISOString(),
    };
  }, [photoUrl]);

  // Newest first, and theirs is the newest — so it lands where a real upload
  // would, rather than being pinned somewhere flattering.
  const galleryPhotos = useMemo(() => {
    const rest = [...DEMO_PHOTOS].reverse();
    return visitorPhoto && visitorPhotoVisible(approved) ? [visitorPhoto, ...rest] : rest;
  }, [visitorPhoto, approved]);

  const copy = DEMO_STEP_COPY[step];
  const forward = nextStep(step);

  function restart() {
    setPhoto(null);
    setApproved(false);
    setError(null);
    setStep('add');
  }

  return (
    <Layout title="Try the demo" width="wide">
      <section className="mx-auto max-w-3xl py-10">
        <div className="text-center">
          <p className="sp-eyebrow">Try it yourself</p>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            {DEMO_EVENT.name}
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-muted">
            Play both parts: add a photo the way a guest would, then approve it
            the way you would.{' '}
            <strong className="font-semibold text-ink">
              Your photo never leaves this device
            </strong>{' '}
            — nothing here is uploaded.
          </p>
        </div>

        {/* Progress */}
        <ol className="mt-10 flex items-center justify-center gap-2" aria-label="Progress">
          {DEMO_STEPS.map((entry, i) => {
            const done = stepNumber(entry) < stepNumber(step);
            const current = entry === step;
            return (
              <li key={entry} className="flex items-center gap-2">
                <span
                  aria-current={current ? 'step' : undefined}
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                    current
                      ? 'bg-ink text-white'
                      : done
                        ? 'bg-accent/15 text-accent'
                        : 'bg-ink/[0.06] text-muted'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                {i < DEMO_STEPS.length - 1 ? (
                  <span aria-hidden className="h-px w-6 bg-line sm:w-10" />
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="sp-card mt-8 p-6 sm:p-9">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                Step {stepNumber(step)} of {DEMO_STEPS.length}
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
                {copy.label}
              </h2>
            </div>
            <RoleBadge role={copy.role} />
          </div>
          <p className="mt-3 leading-relaxed text-muted">{copy.blurb}</p>

          <div className="mt-8">
            {step === 'add' ? (
              <>
                <label
                  htmlFor="demo-photo"
                  className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-smoke px-6 py-14 text-center transition hover:border-accent/50"
                >
                  <span className="font-display text-lg font-bold tracking-tight">
                    Choose a photo
                  </span>
                  <span className="mt-2 max-w-sm text-sm text-muted">
                    On a phone this opens your camera or camera roll — exactly what a
                    guest sees after scanning the code.
                  </span>
                  <input
                    ref={inputRef}
                    id="demo-photo"
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={handleFile}
                  />
                </label>
                {error ? (
                  <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </p>
                ) : null}
                <p className="mt-4 text-center text-sm text-muted">
                  Would rather not?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setPhoto(DEMO_PHOTOS[2].url);
                      setStep('held');
                    }}
                    className="font-medium text-accent underline"
                  >
                    Use one of ours instead
                  </button>
                </p>
              </>
            ) : null}

            {step === 'held' && photoUrl ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
                <p className="text-sm font-semibold text-amber-900">
                  {approved ? 'Approved' : 'Waiting for your approval'}
                </p>
                <p className="mt-1 text-sm text-amber-900/80">
                  {approved
                    ? 'Guests can see it now.'
                    : 'Guests cannot see this yet. On a real event you would get an email, and you can review from your phone.'}
                </p>
                <div className="mt-4 overflow-hidden rounded-xl bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl}
                    alt="The photo you chose, waiting for review"
                    className="max-h-80 w-full object-contain"
                  />
                </div>
                {!approved ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setApproved(true)}
                      className="sp-btn-primary"
                    >
                      Approve it
                    </button>
                    <button type="button" onClick={restart} className="sp-btn-ghost">
                      Reject and start over
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 'gallery' ? (
              <PhotoGrid photos={galleryPhotos} eventName={DEMO_EVENT.name} />
            ) : null}

            {step === 'live' ? (
              <>
                <MiniSlideshow photos={galleryPhotos} />
                <p className="mt-4 text-center text-sm text-muted">
                  On the night this runs full-screen on a TV or projector.{' '}
                  <Link href="/demo/live" className="font-medium text-accent underline">
                    Open the full-screen version
                  </Link>
                </p>
              </>
            ) : null}
          </div>

          {/* Advance. Approving is the gate on step two — the whole point is
              that a held photo does not move until the host says so. */}
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6">
            <button type="button" onClick={restart} className="text-sm text-muted underline">
              Start over
            </button>
            {forward ? (
              <button
                type="button"
                disabled={step === 'held' && !approved}
                onClick={() => setStep(forward)}
                className="sp-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {step === 'held' && !approved
                  ? 'Approve it first'
                  : `Next: ${DEMO_STEP_COPY[forward].label}`}
              </button>
            ) : (
              <Link href="/create-event" className="sp-btn-primary">
                Create your event
              </Link>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-muted">
          The sample photos are illustrations, not photographs, and this is not a real
          event.{' '}
          <Link href="/pricing" className="text-accent underline">
            See pricing
          </Link>
        </p>
      </section>
    </Layout>
  );
}
