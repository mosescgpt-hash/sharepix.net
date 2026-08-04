import { useState } from 'react';
import { DisplayPhoto } from '@/lib/types';
import { deleteEventPhoto, setPhotoApproval } from '@/lib/api';
import { isVideoFilename } from '@/lib/validation';

interface AdminPhotoGridProps {
  photos: DisplayPhoto[];
  onChanged: () => void;
  /**
   * When true, approved photos show a "include in the download QR" toggle so the
   * host builds the share selection right here — no separate selection grid.
   */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
}

export default function AdminPhotoGrid({
  photos,
  onChanged,
  selectable = false,
  selectedIds,
  onToggleSelected,
}: AdminPhotoGridProps) {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggleApproval(photo: DisplayPhoto) {
    setWorkingId(photo.id);
    setError(null);
    try {
      await setPhotoApproval(photo.id, photo.approved === false);
      onChanged();
    } catch {
      setError('Could not update that photo. Try again.');
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDelete(photo: DisplayPhoto) {
    const confirmed = window.confirm('Delete this photo permanently? This removes the file and its record.');
    if (!confirmed) return;
    setWorkingId(photo.id);
    setError(null);
    try {
      await deleteEventPhoto(photo);
      onChanged();
    } catch {
      setError('Could not delete that photo. Try again.');
    } finally {
      setWorkingId(null);
    }
  }

  if (photos.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink/20 bg-white px-4 py-12 text-center text-ink/60">
        No photos or videos have been uploaded to this event yet.
      </p>
    );
  }

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((photo) => {
          const hidden = photo.approved === false;
          const busy = workingId === photo.id;
          const isVideo = isVideoFilename(photo.s3Key);
          // Only approved photos can be shared, so the toggle is offered on them.
          const canSelect = selectable && !hidden;
          const isSelected = selectedIds?.has(photo.id) ?? false;
          return (
            <figure
              key={photo.id}
              className={`overflow-hidden rounded-xl border bg-white ${
                hidden ? 'border-amber-400' : isSelected ? 'border-accent' : 'border-ink/10'
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
                    className={`aspect-square w-full bg-black object-contain ${hidden ? 'opacity-50' : ''}`}
                  />
                ) : (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={`Photo uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
                      loading="lazy"
                      className={`aspect-square w-full object-cover ${hidden ? 'opacity-50' : ''}`}
                    />
                  </>
                )}
                {canSelect ? (
                  <button
                    type="button"
                    onClick={() => onToggleSelected?.(photo.id)}
                    aria-pressed={isSelected}
                    aria-label={isSelected ? 'Remove from download QR' : 'Add to download QR'}
                    className={`absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full border-2 border-white text-sm font-bold shadow ${
                      isSelected ? 'bg-accent text-white' : 'bg-black/40 text-white/90'
                    }`}
                  >
                    {isSelected ? '✓' : ''}
                  </button>
                ) : null}
              </div>
              <figcaption className="space-y-2 px-3 py-2 text-xs">
                <p className="truncate font-medium">{photo.uploadedBy || 'Anonymous'}</p>
                {photo.uploadedByUserId ? (
                  <p className="truncate text-ink/50">User: {photo.uploadedByUserId}</p>
                ) : null}
                {hidden ? (
                  <p className="font-medium text-amber-600">Hidden from gallery</p>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleToggleApproval(photo)}
                    className="flex-1 rounded-full border border-ink/20 px-2 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {hidden ? 'Approve' : 'Hide'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(photo)}
                    className="flex-1 rounded-full border border-red-200 px-2 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
