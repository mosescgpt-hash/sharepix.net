import { useEffect, useMemo, useState } from 'react';
import { DisplayPhoto } from '@/lib/types';
import PhotoCard from '@/components/PhotoCard';
import PrintOrderModal from '@/components/PrintOrderModal';
import { downloadPhoto, downloadPhotosAsZip, getOriginalMediaSource } from '@/lib/api';
import { FallbackImage } from '@/components/FallbackMedia';
import type { MediaSource } from '@/lib/mediaSource';
import { GallerySort, sortGalleryPhotos } from '@/lib/gallery';
import { isVideoFilename } from '@/lib/validation';

interface PhotoGridProps {
  photos: DisplayPhoto[];
  emptyMessage?: string;
  canDownload?: boolean;
  eventName?: string;
  downloadMessage?: string;
  /** Hosts only: click a photo to open the full-quality original. */
  canViewOriginal?: boolean;
  /**
   * When set (and downloads are unlocked), guests can order prints of photos.
   * Falls back to the photos' own eventId so the gallery page can omit it.
   */
  eventId?: string;
  /** Whether print ordering is offered (defaults to the same gate as downloads). */
  canOrderPrints?: boolean;
}

const SORT_STORAGE_KEY = 'sharepix-gallery-sort';
const SORT_OPTIONS: GallerySort[] = [
  'date-newest',
  'date-oldest',
  'time-newest',
  'time-oldest',
  'uploader',
];

export default function PhotoGrid({
  photos,
  emptyMessage,
  canDownload = false,
  eventName = 'sharepix-event',
  downloadMessage,
  canViewOriginal = false,
  eventId,
  canOrderPrints,
}: PhotoGridProps) {
  const [sort, setSort] = useState<GallerySort>('time-newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [enlargedIndex, setEnlargedIndex] = useState<number | null>(null);
  const [printPhotos, setPrintPhotos] = useState<DisplayPhoto[] | null>(null);
  const [originalSource, setOriginalSource] = useState<MediaSource | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);
  const sortedPhotos = useMemo(() => sortGalleryPhotos(photos, sort), [photos, sort]);
  // Only images open in the enlarged viewer (videos play inline), so the
  // prev/next arrows step through the images and the index points into this set.
  const enlargeablePhotos = useMemo(
    () => sortedPhotos.filter((photo) => !isVideoFilename(photo.s3Key)),
    [sortedPhotos],
  );
  const enlarged = enlargedIndex != null ? enlargeablePhotos[enlargedIndex] ?? null : null;
  const hasPrevEnlarged = enlargedIndex != null && enlargedIndex > 0;
  const hasNextEnlarged = enlargedIndex != null && enlargedIndex < enlargeablePhotos.length - 1;
  // True when every photo is currently selected — flips "Select all" to "Unselect all".
  const allSelected = sortedPhotos.length > 0 && selected.size >= sortedPhotos.length;

  // Prints ride the same gate as downloads unless a caller says otherwise, and
  // are only offered where the caller opts in by passing an eventId (the public
  // gallery), not on the share/admin views that reuse this grid.
  const orderEventId = eventId ?? '';
  const printsEnabled = (canOrderPrints ?? canDownload) && !!orderEventId;

  function openPrints() {
    // Order the current selection, or everything when nothing is selected.
    const target = selected.size
      ? sortedPhotos.filter((photo) => selected.has(photo.id))
      : sortedPhotos;
    setPrintPhotos(target);
  }

  async function loadOriginal(photo: DisplayPhoto) {
    setOriginalSource(null);
    setOriginalLoading(true);
    try {
      setOriginalSource(await getOriginalMediaSource(photo));
    } catch {
      // Show the preview we already have rather than nothing.
      setOriginalSource({ primary: photo.url, fallback: photo.fallbackUrl });
    } finally {
      setOriginalLoading(false);
    }
  }

  function showEnlargedAt(index: number) {
    const photo = enlargeablePhotos[index];
    if (!photo) return;
    setEnlargedIndex(index);
    void loadOriginal(photo);
  }

  function openEnlarge(photo: DisplayPhoto) {
    const index = enlargeablePhotos.findIndex((candidate) => candidate.id === photo.id);
    if (index !== -1) showEnlargedAt(index);
  }

  function closeEnlarge() {
    setEnlargedIndex(null);
    setOriginalSource(null);
  }

  function showPrevEnlarged() {
    if (enlargedIndex != null && enlargedIndex > 0) showEnlargedAt(enlargedIndex - 1);
  }

  function showNextEnlarged() {
    if (enlargedIndex != null && enlargedIndex < enlargeablePhotos.length - 1) {
      showEnlargedAt(enlargedIndex + 1);
    }
  }

  useEffect(() => {
    if (enlargedIndex == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEnlarge();
      else if (event.key === 'ArrowLeft') showPrevEnlarged();
      else if (event.key === 'ArrowRight') showNextEnlarged();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlargedIndex, enlargeablePhotos]);

  // Restore the last chosen sort so it survives a gallery refresh.
  useEffect(() => {
    const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
    if (saved && (SORT_OPTIONS as string[]).includes(saved)) {
      setSort(saved as GallerySort);
    }
  }, []);

  function changeSort(next: GallerySort) {
    setSort(next);
    window.localStorage.setItem(SORT_STORAGE_KEY, next);
  }

  useEffect(() => {
    const currentIds = new Set(photos.map((photo) => photo.id));
    setSelected((previous) => new Set([...previous].filter((id) => currentIds.has(id))));
  }, [photos]);

  function toggleSelected(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDownload() {
    const target = selected.size
      ? sortedPhotos.filter((photo) => selected.has(photo.id))
      : sortedPhotos;
    setDownloading(true);
    setError(null);
    setFailedIds(new Set());
    setDownloadProgress(`Preparing 0 of ${target.length}`);
    try {
      const { skipped, failedIds: failed } = await downloadPhotosAsZip(
        target,
        eventName,
        (completed, total) => {
          setDownloadProgress(`Preparing ${completed} of ${total}`);
        },
      );
      if (skipped > 0) {
        setFailedIds(new Set(failed));
        setError(
          `Downloaded ${target.length - skipped} of ${target.length}. ${skipped} file${skipped === 1 ? '' : 's'} (highlighted in red) could not be found and ${skipped === 1 ? 'was' : 'were'} skipped.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The download could not be prepared.');
    } finally {
      setDownloading(false);
      setDownloadProgress('');
    }
  }

  if (photos.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink/20 bg-white px-4 py-12 text-center text-ink/60">
        {emptyMessage ?? 'No photos or videos yet. Scan the event QR code to add the first one.'}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-ink/10 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm font-medium">
          Sort
          <select
            value={sort}
            onChange={(event) => changeSort(event.target.value as GallerySort)}
            className="rounded-lg border border-ink/20 bg-white px-3 py-2"
          >
            <option value="date-newest">Date — newest day</option>
            <option value="date-oldest">Date — oldest day</option>
            <option value="time-newest">Time — newest first</option>
            <option value="time-oldest">Time — oldest first</option>
            <option value="uploader">Uploader — A to Z</option>
          </select>
        </label>

        {canDownload || printsEnabled ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() =>
                setSelected(
                  allSelected ? new Set() : new Set(sortedPhotos.map((photo) => photo.id)),
                )
              }
              className="rounded-full border border-ink/20 px-3 py-2 font-medium hover:border-accent"
            >
              {allSelected ? 'Unselect all' : 'Select all'}
            </button>
            {selected.size && !allSelected ? (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="px-2 py-2 text-ink/60 underline"
              >
                Deselect all ({selected.size})
              </button>
            ) : null}
            {printsEnabled ? (
              <button
                type="button"
                onClick={openPrints}
                className="rounded-full border border-accent px-4 py-2 font-medium text-accent hover:bg-accent/5"
              >
                {selected.size ? `Order prints (${selected.size})` : 'Order prints'}
              </button>
            ) : null}
            {canDownload ? (
              <button
                type="button"
                onClick={handleBulkDownload}
                disabled={downloading}
                className="rounded-full bg-ink px-4 py-2 font-medium text-white hover:bg-night disabled:opacity-50"
              >
                {downloading
                  ? downloadProgress
                  : selected.size
                    ? `Download selected (${selected.size})`
                    : `Download all (${photos.length})`}
              </button>
            ) : null}
          </div>
        ) : downloadMessage ? (
          <p className="text-sm text-ink/60">{downloadMessage}</p>
        ) : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {sortedPhotos.map((photo, i) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            canDownload={canDownload}
            selectable={canDownload}
            selected={selected.has(photo.id)}
            failed={failedIds.has(photo.id)}
            eventName={eventName}
            index={i + 1}
            onToggleSelected={() => toggleSelected(photo.id)}
            onEnlarge={
              canViewOriginal && !isVideoFilename(photo.s3Key)
                ? () => openEnlarge(photo)
                : undefined
            }
          />
        ))}
      </div>

      {enlarged ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          role="dialog"
          aria-modal="true"
          onClick={closeEnlarge}
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
            <p className="truncate text-sm">
              {enlargedIndex != null ? (
                <span className="text-white/60">
                  {enlargedIndex + 1} / {enlargeablePhotos.length} ·{' '}
                </span>
              ) : null}
              Full quality · uploaded by {enlarged.uploadedBy || 'Anonymous'}
            </p>
            <button
              type="button"
              onClick={closeEnlarge}
              aria-label="Close full-quality view"
              className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
            >
              Close ✕
            </button>
          </div>

          {hasPrevEnlarged ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showPrevEnlarged();
              }}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:left-4"
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          ) : null}
          {hasNextEnlarged ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showNextEnlarged();
              }}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 sm:right-4"
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ) : null}
          <div
            className="flex flex-1 items-center justify-center overflow-auto p-4"
            onClick={(event) => event.stopPropagation()}
          >
            {originalLoading ? (
              <p className="text-sm text-white/70">Loading full-quality photo…</p>
            ) : originalSource ? (
              <FallbackImage
                source={originalSource}
                alt={`Full-quality photo uploaded by ${enlarged.uploadedBy ?? 'Anonymous'}`}
                className="max-h-full max-w-full object-contain"
              />
            ) : null}
          </div>
          <div
            className="flex justify-center gap-3 px-4 py-3"
            onClick={(event) => event.stopPropagation()}
          >
            {printsEnabled ? (
              <button
                type="button"
                onClick={() => {
                  const photo = enlarged;
                  closeEnlarge();
                  setPrintPhotos([photo]);
                }}
                className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white hover:bg-accent/90"
              >
                Order print
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => downloadPhoto(enlarged, { eventName })}
              className="rounded-full bg-white px-6 py-2.5 text-sm font-medium text-ink hover:bg-white/90"
            >
              Download original
            </button>
          </div>
        </div>
      ) : null}

      {printPhotos && orderEventId ? (
        <PrintOrderModal
          photos={printPhotos}
          eventId={orderEventId}
          onClose={() => setPrintPhotos(null)}
        />
      ) : null}
    </div>
  );
}
