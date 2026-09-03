import { useMemo, useState } from 'react';
import { DisplayPhoto } from '@/lib/types';
import { downloadPhoto } from '@/lib/api';
import { isVideoFilename } from '@/lib/validation';
import { FallbackImage, FallbackVideo } from '@/components/FallbackMedia';

interface PhotoCardProps {
  photo: DisplayPhoto;
  canDownload?: boolean;
  selectable?: boolean;
  selected?: boolean;
  /** True when a bulk download couldn't fetch this file (missing original). */
  failed?: boolean;
  onToggleSelected?: () => void;
  /** When set (hosts only), clicking the photo opens the full-quality view. */
  onEnlarge?: () => void;
  /** Context for the download filename: 001-Event-Name-Uploader.jpg */
  eventName?: string;
  /** 1-based position in the gallery, for the download filename. */
  index?: number;
}

export default function PhotoCard({
  photo,
  canDownload = false,
  selectable = false,
  selected = false,
  failed = false,
  onToggleSelected,
  onEnlarge,
  eventName,
  index,
}: PhotoCardProps) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadPhoto(photo, { eventName, index });
    } finally {
      setDownloading(false);
    }
  }

  const uploadedAt = photo.createdAt ? new Date(photo.createdAt) : null;
  const isVideo = isVideoFilename(photo.s3Key);
  // Memoized so the element isn't handed a new object every render, which would
  // reset the src mid-fallback.
  const source = useMemo(
    () => ({ primary: photo.url, fallback: photo.fallbackUrl }),
    [photo.url, photo.fallbackUrl],
  );

  return (
    <figure
      className={`relative overflow-hidden rounded-xl border bg-white transition ${
        failed
          ? 'border-red-500 ring-2 ring-red-500'
          : selected
            ? 'border-accent ring-2 ring-accent'
            : 'border-ink/10'
      }`}
    >
      <div className="relative">
        {isVideo ? (
          <FallbackVideo
            source={source}
            controls
            playsInline
            preload="metadata"
            aria-label={`Video uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
            className="aspect-square w-full bg-black object-contain"
          />
        ) : onEnlarge ? (
          // Hosts can click to open the full-quality original.
          <button
            type="button"
            onClick={onEnlarge}
            aria-label="View full-quality photo"
            className="block w-full cursor-zoom-in"
          >
            <FallbackImage
              source={source}
              alt={`Photo uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
              loading="lazy"
              className="aspect-square w-full object-cover"
            />
          </button>
        ) : (
          <FallbackImage
            source={source}
            alt={`Photo uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
            loading="lazy"
            className="aspect-square w-full object-cover"
          />
        )}

        {failed ? (
          <span className="absolute right-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
            Unavailable
          </span>
        ) : null}

        {selectable ? (
          <button
            type="button"
            onClick={onToggleSelected}
            aria-label={selected ? 'Remove from selection' : 'Select this item'}
            aria-pressed={selected}
            className={`absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full border-2 text-sm font-bold shadow ${
              selected
                ? 'border-white bg-accent text-white'
                : 'border-white bg-black/40 text-white hover:bg-accent'
            }`}
          >
            {selected ? '✓' : ''}
          </button>
        ) : null}
      </div>

      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <div className="min-w-0">
          <p className="truncate font-medium">Uploaded by: {photo.uploadedBy || 'Anonymous'}</p>
          {uploadedAt ? (
            <p className="text-muted">
              {uploadedAt.toLocaleDateString()} ·{' '}
              {uploadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
          ) : null}
        </div>
        {canDownload ? (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="shrink-0 rounded-full border border-ink/20 px-3 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {downloading ? '…' : 'Download'}
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}
