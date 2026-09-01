import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { isVideoFilename } from '@/lib/validation';
import { isVideoItem, QueuedMedia } from '@/lib/uploadQueue';
import type { MediaUpload } from '@/hooks/useMediaUpload';

/**
 * Twin Cities Con 2026 post-selection experience.
 *
 * Presentation only — every piece of upload/validation/retry behaviour comes
 * from the shared `useMediaUpload` hook (the same one the default form uses), so
 * this file adds no upload logic. It reuses the existing library file input
 * (id `photo-library-input`) to add or swap photos, and links to the real event
 * gallery route.
 */
export default function TccUploadExperience({
  upload,
  galleryHref,
}: {
  upload: MediaUpload;
  galleryHref: string;
}) {
  const { queue, busy, phase, overall, counts, retryFailed, retryable, removeFile, upload: startUpload } = upload;

  // Object URLs for image previews, created lazily and revoked on removal and
  // unmount so a big selection doesn't leak memory. Videos are shown as a light
  // placeholder tile rather than a decoded frame, which keeps memory down.
  const urlsRef = useRef<Map<string, string>>(new Map());
  const [, force] = useState(0);
  useEffect(() => {
    const map = urlsRef.current;
    let changed = false;
    for (const item of queue) {
      if (!isVideoFilename(item.file.name) && !map.has(item.id)) {
        map.set(item.id, URL.createObjectURL(item.file));
        changed = true;
      }
    }
    for (const id of [...map.keys()]) {
      if (!queue.some((q) => q.id === id)) {
        URL.revokeObjectURL(map.get(id)!);
        map.delete(id);
        changed = true;
      }
    }
    if (changed) force((n) => n + 1);
  }, [queue]);
  useEffect(
    () => () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      urlsRef.current.clear();
    },
    [],
  );

  function openLibraryPicker() {
    (document.getElementById('photo-library-input') as HTMLInputElement | null)?.click();
  }

  const total = queue.filter((item) => item.status !== 'error').length;
  const photoCount = queue.filter((item) => !isVideoItem(item)).length;
  const videoCount = queue.filter((item) => isVideoItem(item)).length;

  return (
    <div className="tcc-theme rounded-2xl px-4 py-6 sm:px-6">
      {phase === 'success' ? (
        <SuccessPanel galleryHref={galleryHref} onAddMore={openLibraryPicker} doneCount={counts.done} />
      ) : phase === 'partial' ? (
        <PartialPanel
          queue={queue}
          counts={counts}
          galleryHref={galleryHref}
          previewUrl={(item) => urlsRef.current.get(item.id)}
          onRetry={retryFailed}
          retryable={retryable}
        />
      ) : (
        <ReviewOrUploading
          queue={queue}
          busy={busy}
          overall={overall}
          total={total}
          photoCount={photoCount}
          videoCount={videoCount}
          canUpload={upload.canUpload}
          previewUrl={(item) => urlsRef.current.get(item.id)}
          onSend={startUpload}
          onChooseDifferent={openLibraryPicker}
          onRemove={removeFile}
        />
      )}

      <p className="mt-6 text-center text-xs text-[color:var(--tcc-muted)]">
        Powered by SharePix — every guest becomes a photographer.
      </p>
    </div>
  );
}

/* ---- shared bits ------------------------------------------------------- */

function Eyebrow() {
  return <span className="tcc-eyebrow px-3 py-1 text-[11px]">TWIN CITIES CON 2026</span>;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-3 font-display text-2xl font-extrabold leading-tight sm:text-3xl">{children}</h2>
  );
}

/** A comic tile for one selected file — preserves aspect ratio, marks video,
 *  surfaces validation problems, and (before upload) can be removed. */
function MediaTile({
  item,
  url,
  onRemove,
}: {
  item: QueuedMedia;
  url: string | undefined;
  onRemove?: (id: string) => void;
}) {
  const video = isVideoItem(item);
  const failedValidation = item.status === 'error';

  return (
    <div
      className={`tcc-panel relative overflow-hidden ${failedValidation ? 'border-[color:var(--tcc-magenta)]' : ''}`}
    >
      <div className="flex aspect-square items-center justify-center bg-[color:var(--tcc-ink)]">
        {video ? (
          <div className="flex flex-col items-center gap-1 px-2 text-center">
            <span aria-hidden className="text-2xl">🎬</span>
            <span className="rounded-full bg-[color:var(--tcc-magenta)] px-2 py-0.5 text-[10px] font-bold text-white">
              VIDEO
            </span>
          </div>
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={item.file.name}
            className="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span aria-hidden className="text-2xl">🖼️</span>
        )}
      </div>

      {/* Status / progress strip — never colour-only; always has text. */}
      <div className="px-2 py-1.5">
        <p className="truncate text-[11px] text-[color:var(--tcc-muted)]" title={item.file.name}>
          {item.file.name}
        </p>
        {item.status === 'uploading' ? (
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/15"
            role="progressbar"
            aria-valuenow={item.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Uploading ${item.file.name}`}
          >
            <div className="tcc-progress-fill h-full" style={{ width: `${item.percent}%` }} />
          </div>
        ) : (
          <p className="mt-0.5 text-[11px] font-semibold">
            {item.status === 'done' && <span className="text-[color:var(--tcc-cyan)]">✓ In the gallery</span>}
            {item.status === 'duplicate' && <span className="text-[color:var(--tcc-muted)]">Already added</span>}
            {item.status === 'error' && <span className="text-[color:var(--tcc-magenta)]">✕ Couldn’t send</span>}
            {item.status === 'pending' && <span className="text-[color:var(--tcc-muted)]">Ready</span>}
          </p>
        )}
        {item.error ? <p className="mt-0.5 text-[11px] text-[color:var(--tcc-magenta)]">{item.error}</p> : null}
      </div>

      {onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label={`Remove ${item.file.name}`}
          className="tcc-btn-ghost absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--tcc-ink)]/80 text-lg leading-none"
        >
          <span aria-hidden>×</span>
        </button>
      ) : null}
    </div>
  );
}

/* ---- review + uploading ------------------------------------------------ */

function ReviewOrUploading({
  queue,
  busy,
  overall,
  total,
  photoCount,
  videoCount,
  canUpload,
  previewUrl,
  onSend,
  onChooseDifferent,
  onRemove,
}: {
  queue: QueuedMedia[];
  busy: boolean;
  overall: number;
  total: number;
  photoCount: number;
  videoCount: number;
  canUpload: boolean;
  previewUrl: (item: QueuedMedia) => string | undefined;
  onSend: () => void;
  onChooseDifferent: () => void;
  onRemove: (id: string) => void;
}) {
  const summary = [
    photoCount ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : '',
    videoCount ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div>
      <div className="tcc-actionlines rounded-xl px-3 py-4 text-center">
        <Eyebrow />
        <Heading>{busy ? 'Sending your photos to the gallery…' : 'Your photos are ready for their debut!'}</Heading>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[color:var(--tcc-muted)]">
          {busy
            ? 'Keep this page open until every upload is complete.'
            : 'Review your selections, then send them to the live TCC cosplay gallery.'}
        </p>
      </div>

      {busy ? (
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs font-semibold text-[color:var(--tcc-muted)]">
            <span aria-hidden>Sending…</span>
            <span>{overall}%</span>
          </div>
          <div
            className="mt-1 h-3 w-full overflow-hidden rounded-full border-2 border-[color:var(--tcc-text)] bg-white/10"
            role="progressbar"
            aria-valuenow={overall}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Overall upload progress"
          >
            <div className="tcc-progress-fill h-full" style={{ width: `${overall}%` }} />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-center text-sm font-semibold" aria-live="polite">
          {summary || 'Nothing selected yet'}
        </p>
      )}

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {queue.map((item) => (
          <li key={item.id}>
            <MediaTile item={item} url={previewUrl(item)} onRemove={busy ? undefined : onRemove} />
          </li>
        ))}
      </ul>

      {!busy ? (
        <p className="mt-4 text-center text-xs text-[color:var(--tcc-muted)]">
          Uploads may be reviewed before appearing in the public gallery.
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        <button
          type="button"
          onClick={onSend}
          disabled={!canUpload}
          className="tcc-btn-primary flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 text-base disabled:opacity-60"
        >
          {busy ? (
            'Sending…'
          ) : (
            <>
              Send to the TCC Gallery
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>
        {!busy ? (
          <button
            type="button"
            onClick={onChooseDifferent}
            className="tcc-btn-ghost w-full rounded-full px-5 py-3 text-sm"
          >
            Choose Different Photos
          </button>
        ) : (
          <p className="text-center text-xs text-[color:var(--tcc-muted)]">
            {total} file{total === 1 ? '' : 's'} on the way — this can take a moment on convention Wi-Fi.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---- success ----------------------------------------------------------- */

function SuccessPanel({
  galleryHref,
  onAddMore,
  doneCount,
}: {
  galleryHref: string;
  onAddMore: () => void;
  doneCount: number;
}) {
  return (
    <div className="relative text-center">
      <Confetti />
      <div className="relative">
        <Eyebrow />
        <Heading>You’re in the gallery!</Heading>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[color:var(--tcc-muted)]">
          Your memories are now part of the TCC 2026 SharePix gallery.
          {doneCount > 0 ? ` ${doneCount} added.` : ''}
        </p>

        <div className="mt-6 space-y-3">
          <Link
            href={galleryHref}
            className="tcc-btn-primary flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 text-base"
          >
            View the Live Gallery
          </Link>
          <button type="button" onClick={onAddMore} className="tcc-btn-ghost w-full rounded-full px-5 py-3 text-sm">
            Add More Photos
          </button>
        </div>
      </div>
    </div>
  );
}

/** A few CSS burst shapes. Decorative, aria-hidden, motion-gated in CSS. */
function Confetti() {
  const bits = [
    { c: 'var(--tcc-cyan)', dx: '-70px', dy: '-30px', rot: '120deg', left: '20%', delay: '0ms' },
    { c: 'var(--tcc-magenta)', dx: '60px', dy: '-40px', rot: '-90deg', left: '70%', delay: '80ms' },
    { c: 'var(--tcc-yellow)', dx: '-30px', dy: '-60px', rot: '160deg', left: '40%', delay: '40ms' },
    { c: 'var(--tcc-cyan)', dx: '40px', dy: '-20px', rot: '-140deg', left: '55%', delay: '120ms' },
    { c: 'var(--tcc-yellow)', dx: '-55px', dy: '-50px', rot: '80deg', left: '30%', delay: '160ms' },
    { c: 'var(--tcc-magenta)', dx: '75px', dy: '-25px', rot: '110deg', left: '80%', delay: '60ms' },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-2 h-0">
      {bits.map((b, i) => (
        <span
          key={i}
          className="tcc-burst"
          style={
            {
              left: b.left,
              backgroundColor: b.c,
              animationDelay: b.delay,
              ['--tcc-dx' as string]: b.dx,
              ['--tcc-dy' as string]: b.dy,
              ['--tcc-rot' as string]: b.rot,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/* ---- partial / error --------------------------------------------------- */

function PartialPanel({
  queue,
  counts,
  galleryHref,
  previewUrl,
  onRetry,
  retryable,
}: {
  queue: QueuedMedia[];
  counts: { done: number; failed: number };
  galleryHref: string;
  previewUrl: (item: QueuedMedia) => string | undefined;
  onRetry: () => void;
  /** Failed items a retry could fix; the rest are permanent and stay put. */
  retryable: number;
}) {
  const failed = queue.filter((item) => item.status === 'error');
  return (
    <div>
      <div className="text-center">
        <Eyebrow />
        <Heading>Some photos didn’t make it through.</Heading>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[color:var(--tcc-muted)]">
          Try those files again. Your successful uploads are already safe
          {counts.done > 0 ? ` (${counts.done} in the gallery)` : ''}.
        </p>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {failed.map((item) => (
          <li key={item.id}>
            <MediaTile item={item} url={previewUrl(item)} />
          </li>
        ))}
      </ul>

      <div className="mt-5 space-y-3">
        {retryable > 0 ? (
          <button
            type="button"
            onClick={onRetry}
            className="tcc-btn-primary w-full rounded-full px-5 py-4 text-base"
          >
            Retry {retryable} file{retryable === 1 ? '' : 's'}
          </button>
        ) : null}
        {counts.done > 0 ? (
          <Link href={galleryHref} className="tcc-btn-ghost block w-full rounded-full px-5 py-3 text-center text-sm">
            View the Live Gallery
          </Link>
        ) : null}
      </div>
    </div>
  );
}
