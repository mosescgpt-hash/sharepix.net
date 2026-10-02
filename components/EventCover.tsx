import { useEffect, useState, type ReactNode } from 'react';
import { getEventCoverSource } from '@/lib/api';
import { coverCountdown, resolveEventCover, type ResolvedCover } from '@/lib/eventCover';
import { initialSource, sourceAfterError, type MediaSource } from '@/lib/mediaSource';
import type { QREvent } from '@/lib/types';

interface Props {
  event: QREvent;
  /** Small line above the headline, e.g. "You're adding photos to". */
  eyebrow?: ReactNode;
  /** Lines under the headline: date, location. Replaced by a custom subtitle. */
  meta?: ReactNode;
  /** Buttons along the bottom. */
  children?: ReactNode;
  /**
   * A cover to show instead of the stored one — the settings card's live
   * preview, before anything is saved.
   */
  cover?: ResolvedCover;
  /** A local URL for a photo that has not been uploaded yet. */
  imageSrc?: string | null;
  /** Inside the settings card: shorter, and the countdown frozen to now. */
  preview?: boolean;
}

const HEIGHT_CLASS: Record<ResolvedCover['height'], string> = {
  compact: 'py-10 sm:py-12',
  standard: 'py-14 sm:py-20',
  tall: 'flex min-h-[70vh] flex-col justify-end py-14 sm:py-20',
};

/**
 * The masthead of an event's pages: the host's photo or chosen background,
 * the headline over it, and the page's own actions underneath.
 *
 * Text here is always light on dark (see lib/eventCover.ts for why), so the
 * section keeps the `spx-section-ink` styles the pages already use, and only
 * its background changes. An event with no cover renders exactly the navy band
 * it always has.
 */
export default function EventCover({
  event,
  eyebrow,
  meta,
  children,
  cover: override,
  imageSrc,
  preview = false,
}: Props) {
  const cover = override ?? resolveEventCover(event);
  const [source, setSource] = useState<MediaSource | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setSrc(null);
    if (imageSrc || !cover.image) return;
    getEventCoverSource(event.id, cover.image)
      .then((found) => {
        if (cancelled) return;
        setSource(found);
        setSrc(initialSource(found) || null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [event.id, cover.image, imageSrc]);

  const photo = imageSrc ?? (cover.image ? src : null);
  const countdown = cover.countdown ? coverCountdown(event) : null;
  const title = cover.title || event.name;
  const centered = cover.align === 'center';
  const height = preview
    ? cover.height === 'tall'
      ? 'flex min-h-[18rem] flex-col justify-end py-10'
      : cover.height === 'compact'
        ? 'py-6'
        : 'py-10'
    : HEIGHT_CLASS[cover.height];

  return (
    <section
      className={`spx-section-ink spx-cover relative isolate overflow-hidden ${height}`}
      // A preset is a gradient from a fixed list, never a stored string, so
      // nothing a host typed reaches this style attribute.
      style={photo || cover.image ? undefined : { background: cover.preset.background }}
    >
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-20 h-full w-full object-cover"
            style={{ objectPosition: `50% ${cover.focus}%` }}
            onError={() => {
              const next = source && src ? sourceAfterError(src, source) : null;
              setSrc(next || null);
            }}
          />
          <div
            aria-hidden
            className="absolute inset-0 -z-10"
            style={{
              // Heavier at the bottom, where the words and buttons sit.
              background: `linear-gradient(180deg, rgba(10,18,28,${(cover.shade / 100) * 0.7}) 0%, rgba(10,18,28,${cover.shade / 100}) 70%, rgba(10,18,28,${Math.min(0.9, cover.shade / 100 + 0.1)}) 100%)`,
            }}
          />
        </>
      ) : null}

      <div className={`spx-inner ${centered ? 'text-center' : ''}`}>
        <div className={centered ? 'mx-auto max-w-2xl' : 'max-w-2xl'}>
          {eyebrow ? <p className="spx-eyebrow">{eyebrow}</p> : null}
          <h1 className={`spx-display mt-3 ${preview ? 'text-3xl sm:text-4xl' : ''}`}>{title}</h1>
          {/* Light, not the accent: an accent is chosen to match the
              event, which usually means it matches this background too. */}
          <span
            aria-hidden
            className={`mt-4 block h-0.5 w-12 bg-canvas/70 ${centered ? 'mx-auto' : ''}`}
          />
          {cover.subtitle ? (
            <p className="spx-display-serif mt-3 text-xl sm:text-2xl">{cover.subtitle}</p>
          ) : (
            meta
          )}
          {countdown ? (
            <p className="mt-4 inline-flex items-center gap-2 border border-canvas/30 bg-ink/40 px-3 py-1 text-sm font-medium text-canvas">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-mint" />
              {countdown}
            </p>
          ) : null}
          {children ? (
            <div className={`mt-8 flex flex-wrap gap-3 ${centered ? 'justify-center' : ''}`}>
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
