import { useEffect, useMemo, useState } from 'react';
import { DisplayPhoto } from '@/lib/types';
import PhotoCard from '@/components/PhotoCard';
import { downloadPhotosAsZip } from '@/lib/api';
import { GallerySort, sortGalleryPhotos } from '@/lib/gallery';

interface PhotoGridProps {
  photos: DisplayPhoto[];
  emptyMessage?: string;
  canDownload?: boolean;
  eventName?: string;
  downloadMessage?: string;
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
}: PhotoGridProps) {
  const [sort, setSort] = useState<GallerySort>('time-newest');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const sortedPhotos = useMemo(() => sortGalleryPhotos(photos, sort), [photos, sort]);

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
    setDownloadProgress(`Preparing 0 of ${target.length}`);
    try {
      await downloadPhotosAsZip(target, eventName, (completed, total) => {
        setDownloadProgress(`Preparing ${completed} of ${total}`);
      });
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

        {canDownload ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setSelected(new Set(sortedPhotos.map((photo) => photo.id)))}
              className="rounded-full border border-ink/20 px-3 py-2 font-medium hover:border-accent"
            >
              Select all
            </button>
            {selected.size ? (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="px-2 py-2 text-ink/60 underline"
              >
                Clear ({selected.size})
              </button>
            ) : null}
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
          </div>
        ) : (
          <p className="text-sm text-ink/60">{downloadMessage}</p>
        )}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {sortedPhotos.map((photo) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            canDownload={canDownload}
            selectable={canDownload}
            selected={selected.has(photo.id)}
            onToggleSelected={() => toggleSelected(photo.id)}
          />
        ))}
      </div>
    </div>
  );
}
