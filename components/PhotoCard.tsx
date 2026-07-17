import { useState } from 'react';
import { DisplayPhoto } from '@/lib/types';
import { downloadPhoto } from '@/lib/api';
import { isVideoFilename } from '@/lib/validation';

interface PhotoCardProps {
  photo: DisplayPhoto;
  canDownload?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
}

export default function PhotoCard({
  photo,
  canDownload = false,
  selectable = false,
  selected = false,
  onToggleSelected,
}: PhotoCardProps) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadPhoto(photo);
    } finally {
      setDownloading(false);
    }
  }

  const uploadedAt = photo.createdAt ? new Date(photo.createdAt) : null;
  const isVideo = isVideoFilename(photo.s3Key);

  return (
    <figure
      className={`relative overflow-hidden rounded-xl border bg-white transition ${
        selected ? 'border-accent ring-2 ring-accent' : 'border-ink/10'
      }`}
    >
      <div className="relative">
        {isVideo ? (
          <video
            src={photo.url}
            controls
            playsInline
            preload="metadata"
            aria-label={`Video uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
            className="aspect-square w-full bg-black object-contain"
          />
        ) : (
          // Signed S3 URLs change constantly, so a plain img tag is simpler than next/image here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo.url}
            alt={`Photo uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
            loading="lazy"
            className="aspect-square w-full object-cover"
          />
        )}

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
            <p className="text-ink/50">
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
