import { useRef, useState, type MouseEvent } from 'react';
import { DisplayPhoto } from '@/lib/types';
import { deleteEventPhoto, releaseFlaggedPhoto, setPhotoApproval } from '@/lib/api';
import { isVideoFilename } from '@/lib/validation';
import { applyClick } from '@/lib/rangeSelect';
import { FallbackImage, FallbackVideo } from '@/components/FallbackMedia';

/** How many deletes run at once when deleting a selection. */
const BULK_DELETE_CONCURRENCY = 4;

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
  // Select-to-delete: separate from the download-QR selection, so picking
  // photos to share can never delete them.
  const [deleteMode, setDeleteMode] = useState(false);
  const [toDelete, setToDelete] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  // The last photo clicked in each selection: where a shift-click range starts.
  const deleteAnchor = useRef<string | null>(null);
  const shareAnchor = useRef<string | null>(null);

  function clickDelete(id: string, e: MouseEvent) {
    const ids = photos.map((p) => p.id);
    // Read now: the updater runs later, after the anchor has moved.
    const anchor = deleteAnchor.current;
    const shift = e.shiftKey;
    setToDelete((prev) => applyClick(prev, ids, anchor, id, shift));
    deleteAnchor.current = id;
  }

  /**
   * The download-QR picks live in the parent, which toggles one at a time, so
   * a range is applied as a toggle of each photo whose state must change.
   * Only approved photos can be shared, so only they are in the range.
   */
  function clickShare(id: string, e: MouseEvent) {
    if (!selectedIds || !onToggleSelected) return;
    const ids = photos.filter((p) => p.approved !== false).map((p) => p.id);
    const next = applyClick(selectedIds, ids, shareAnchor.current, id, e.shiftKey);
    for (const each of ids) {
      if (next.has(each) !== selectedIds.has(each)) onToggleSelected(each);
    }
    shareAnchor.current = id;
  }

  function exitDeleteMode() {
    setDeleteMode(false);
    setToDelete(new Set());
    deleteAnchor.current = null;
  }

  async function handleBulkDelete() {
    const chosen = photos.filter((p) => toDelete.has(p.id));
    if (chosen.length === 0) return;
    const label = `${chosen.length} item${chosen.length === 1 ? '' : 's'}`;
    if (!window.confirm(`Delete ${label} permanently? This removes the files and their records.`)) return;
    setError(null);
    const failed: string[] = [];
    let done = 0;
    setBulkProgress(`Deleting… 0 of ${chosen.length}`);
    // A few at a time: quick for a big batch without flooding the API.
    const queue = [...chosen];
    async function worker() {
      for (let photo = queue.shift(); photo; photo = queue.shift()) {
        try {
          await deleteEventPhoto(photo);
        } catch {
          failed.push(photo.id);
        }
        done += 1;
        setBulkProgress(`Deleting… ${done} of ${chosen.length}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(BULK_DELETE_CONCURRENCY, chosen.length) }, worker));
    setBulkProgress(null);
    if (failed.length > 0) {
      setError(
        `${failed.length} of ${chosen.length} could not be deleted. They are still selected; try again.`,
      );
      setToDelete(new Set(failed));
    } else {
      exitDeleteMode();
    }
    onChanged();
  }

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

  /** Let a photo the screener held back through to guests and the slideshow. */
  async function handleRelease(photo: DisplayPhoto) {
    setWorkingId(photo.id);
    setError(null);
    try {
      await releaseFlaggedPhoto(photo.id);
      onChanged();
    } catch {
      setError('Could not release that photo. Try again.');
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
      <p className="border border-dashed border-charcoal/25 px-4 py-12 text-center text-charcoal/60">
        No photos or videos have been uploaded to this event yet.
      </p>
    );
  }

  return (
    <div>
      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {deleteMode ? (
          <>
            <span className="font-medium">
              {toDelete.size} selected
            </span>
            <button
              type="button"
              onClick={() =>
                setToDelete(toDelete.size === photos.length ? new Set() : new Set(photos.map((p) => p.id)))
              }
              disabled={bulkProgress !== null}
              className="border border-charcoal/25 px-3 py-1 hover:border-charcoal/60 disabled:opacity-50"
            >
              {toDelete.size === photos.length ? 'Select none' : 'Select all'}
            </button>
            <button
              type="button"
              onClick={() => void handleBulkDelete()}
              disabled={toDelete.size === 0 || bulkProgress !== null}
              className="rounded-full bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Delete selected
            </button>
            <button
              type="button"
              onClick={exitDeleteMode}
              disabled={bulkProgress !== null}
              className="px-2 py-1 text-charcoal/70 underline disabled:opacity-50"
            >
              Cancel
            </button>
            {bulkProgress ? (
              <span className="text-charcoal/65">{bulkProgress}</span>
            ) : (
              <span className="hidden text-xs text-charcoal/55 sm:inline">
                Tip: hold Shift and click to select everything in between.
              </span>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setDeleteMode(true)}
            className="rounded-full border border-red-200 px-3 py-1 font-medium text-red-600 hover:bg-red-50"
          >
            Select photos to delete
          </button>
        )}
      </div>
      {/* select-none: a shift-click would otherwise highlight the text between. */}
      <div className="grid select-none grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((photo) => {
          const hidden = photo.approved === false;
          // Held back by content screening — visible to the host only.
          const flagged = photo.moderationStatus === 'flagged';
          const busy = workingId === photo.id;
          const isVideo = isVideoFilename(photo.s3Key);
          // Only approved photos can be shared, so the toggle is offered on them.
          const canSelect = selectable && !hidden && !deleteMode;
          const isSelected = selectedIds?.has(photo.id) ?? false;
          const markedForDelete = deleteMode && toDelete.has(photo.id);
          return (
            <figure
              key={photo.id}
              className={`overflow-hidden rounded-xl border bg-white ${
                markedForDelete
                  ? 'border-red-600 ring-2 ring-red-600'
                  : hidden
                    ? 'border-amber-500'
                    : isSelected && !deleteMode
                      ? 'border-ink'
                      : 'border-charcoal/10'
              }`}
            >
              <div className="relative">
                {isVideo ? (
                  <FallbackVideo
                    source={{ primary: photo.url, fallback: photo.fallbackUrl }}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={`Video uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
                    className={`aspect-square w-full bg-black object-contain ${hidden ? 'opacity-50' : ''}`}
                  />
                ) : (
                  <FallbackImage
                    source={{ primary: photo.url, fallback: photo.fallbackUrl }}
                    alt={`Photo uploaded by ${photo.uploadedBy ?? 'Anonymous'}`}
                    loading="lazy"
                    className={`aspect-square w-full object-cover ${hidden ? 'opacity-50' : ''}`}
                  />
                )}
                {canSelect ? (
                  <button
                    type="button"
                    onClick={(e) => clickShare(photo.id, e)}
                    aria-pressed={isSelected}
                    aria-label={isSelected ? 'Remove from download QR' : 'Add to download QR'}
                    className={`absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full border-2 border-white text-sm font-bold shadow ${
                      isSelected ? 'bg-ink text-canvas' : 'bg-black/40 text-white/90'
                    }`}
                  >
                    {isSelected ? '✓' : ''}
                  </button>
                ) : null}
                {deleteMode ? (
                  // Covers the whole tile, so a tap anywhere picks it (and a
                  // video doesn't start playing instead).
                  <button
                    type="button"
                    onClick={(e) => clickDelete(photo.id, e)}
                    aria-pressed={markedForDelete}
                    aria-label={markedForDelete ? 'Unselect for deletion' : 'Select for deletion'}
                    className={`absolute inset-0 flex items-start justify-end p-2 ${
                      markedForDelete ? 'bg-red-600/20' : ''
                    }`}
                  >
                    <span
                      className={`grid h-7 w-7 place-items-center rounded-full border-2 border-white text-sm font-bold shadow ${
                        markedForDelete ? 'bg-red-600 text-white' : 'bg-black/40 text-white/90'
                      }`}
                    >
                      {markedForDelete ? '✓' : ''}
                    </span>
                  </button>
                ) : null}
              </div>
              <figcaption className="space-y-2 px-3 py-2 text-xs">
                <p className="truncate font-medium">{photo.uploadedBy || 'Anonymous'}</p>
                {photo.uploadedByUserId ? (
                  <p className="truncate text-charcoal/60">User: {photo.uploadedByUserId}</p>
                ) : null}
                {hidden ? (
                  <p className="font-medium text-amber-600">Hidden from gallery</p>
                ) : null}
                {flagged ? (
                  <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-amber-900">
                    <p className="font-semibold">Held for review</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-800/80">
                      Only you can see this. {photo.moderationReasons
                        ? `Detected: ${photo.moderationReasons}.`
                        : ''}{' '}
                      Release it to show guests and the slideshow, or delete it.
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRelease(photo)}
                      className="mt-1.5 w-full rounded-full bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Release photo
                    </button>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleToggleApproval(photo)}
                    className="flex-1 border border-charcoal/25 px-2 py-1 font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
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
