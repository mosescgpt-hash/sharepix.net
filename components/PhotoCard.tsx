import { useState } from 'react';
import { DisplayPhoto } from '@/lib/types';
import { downloadPhoto } from '@/lib/api';

interface PhotoCardProps {
  photo: DisplayPhoto;
}

export default function PhotoCard({ photo }: PhotoCardProps) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadPhoto(photo);
    } finally {
      setDownloading(false);
    }
  }

  const uploadedDate = photo.createdAt
    ? new Date(photo.createdAt).toLocaleDateString()
    : null;

  return (
    <figure className="overflow-hidden rounded-xl border border-ink/10 bg-white">
      {/* Signed S3 URLs change constantly, so a plain img tag is simpler than next/image here */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={`Photo uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
        loading="lazy"
        className="aspect-square w-full object-cover"
      />
      <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <div className="min-w-0">
          <p className="truncate font-medium">
            Uploaded by: {photo.uploadedBy || 'Anonymous'}
          </p>
          {uploadedDate ? <p className="text-ink/50">{uploadedDate}</p> : null}
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="shrink-0 rounded-full border border-ink/20 px-3 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {downloading ? '…' : 'Download'}
        </button>
      </figcaption>
    </figure>
  );
}
