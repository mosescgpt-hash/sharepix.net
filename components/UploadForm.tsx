import { ChangeEvent } from 'react';
import Notice from '@/components/Notice';
import { MAX_VIDEO_SIZE_LABEL } from '@/lib/validation';
import { EventThemeKey } from '@/lib/eventTheme';
import { useMediaUpload } from '@/hooks/useMediaUpload';
import TccUploadExperience from '@/components/tcc/TccUploadExperience';

interface UploadFormProps {
  eventId: string;
  onUploaded?: () => void;
  /** False when the host has turned video off for this event. */
  allowVideo?: boolean;
  /**
   * Videos the plan still has room for, or null when unlimited. The server is
   * the authority — this only lets a guest find out before they wait through an
   * upload that would be refused at the end.
   */
  videosRemaining?: number | null;
  /** Event presentation theme; the default experience when null. */
  themeKey?: EventThemeKey | null;
}

export default function UploadForm({
  eventId,
  onUploaded,
  allowVideo = true,
  videosRemaining = null,
  themeKey = null,
}: UploadFormProps) {
  const upload = useMediaUpload({ eventId, allowVideo, videosRemaining, onUploaded });
  const {
    queue,
    busy,
    successCount,
    duplicateCount,
    uploaderName,
    setUploaderName,
    addFiles,
    upload: startUpload,
    retryFailed,
    retryable,
    counts,
  } = upload;

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  }

  // Camera capture needs a SINGLE simple accept value. Android Chrome only
  // launches the camera when `capture` is paired with one plain type like
  // "image/*" — a list makes it fall back to the file picker. The library
  // input keeps the full list. These are rendered in every branch so the TCC
  // experience's "choose different"/"add more" buttons can trigger them too;
  // this is the file-picker behaviour, deliberately unchanged.
  const fileInputs = (
    <>
      <input
        id="photo-camera-input"
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={handleFileSelect}
      />
      <input
        id="photo-library-input"
        type="file"
        accept={allowVideo ? 'image/*,video/*,.heic,.heif,.mov,.m4v' : 'image/*,.heic,.heif'}
        multiple
        className="sr-only"
        onChange={handleFileSelect}
      />
    </>
  );

  // Themed post-selection experience: only for a themed event, and only once
  // files have been selected. Before selection, and for every other event, the
  // default experience below is untouched.
  if (themeKey === 'tcc-2026' && queue.length > 0) {
    return (
      <>
        {fileInputs}
        <TccUploadExperience upload={upload} galleryHref={`/event/${eventId}`} />
      </>
    );
  }

  const pendingCount = counts.pending;
  const failedCount = counts.failed;

  return (
    <div className="spx-card p-5 sm:p-6">
      <label htmlFor="uploader-name" className="mb-5 block">
        <span className="font-sans text-sm font-medium text-charcoal">
          Your name or nickname (optional)
        </span>
        <input
          id="uploader-name"
          type="text"
          value={uploaderName}
          maxLength={60}
          onChange={(event) => setUploaderName(event.target.value)}
          placeholder="Example: Aunt Maya"
          className="spx-input mt-2"
        />
        <span className="mt-1.5 block text-xs text-charcoal/55">
          This helps everyone sort by uploader. If left blank, this browser gets a reusable guest label.
        </span>
      </label>
      {/* Square and hairline, matching the empty state elsewhere. The camera
          emoji is gone: it renders as a different picture on every platform
          and was the least premium thing on the page. */}
      <div className="border border-dashed border-charcoal/25 px-5 py-8 text-center">
        <p className="spx-display-serif text-2xl">Add your photos.</p>
        <p className="mt-2 text-sm text-charcoal/60">
          {allowVideo && videosRemaining !== 0
            ? `Photos up to 25 MB · MP4, MOV, or WEBM videos up to ${MAX_VIDEO_SIZE_LABEL}`
            : 'Photos up to 25 MB'}
        </p>
        {allowVideo && videosRemaining !== 0 ? (
          <p className="mt-1 text-sm text-charcoal/60">
            Videos go straight to the host — they won’t appear in the guest gallery.
          </p>
        ) : null}
        {allowVideo && videosRemaining !== null ? (
          <p className="mt-1 text-sm text-charcoal/60">
            {videosRemaining === 0
              ? 'This event’s videos are all used — photos only from here.'
              : `Room for ${videosRemaining} more video${videosRemaining === 1 ? '' : 's'}.`}
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label htmlFor="photo-camera-input" className="spx-btn-ink cursor-pointer">
            Camera
          </label>
          <label htmlFor="photo-library-input" className="spx-btn-outline cursor-pointer">
            Choose from device
          </label>
        </div>
      </div>
      {fileInputs}

      {queue.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {queue.map((item) => (
            <li key={item.id} className="border border-charcoal/10 bg-sand/60 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{item.file.name}</span>
                <span className="shrink-0 text-xs text-charcoal/55">
                  {item.status === 'pending' && 'Ready'}
                  {item.status === 'uploading' && `${item.percent}%`}
                  {item.status === 'done' && '✓ Uploaded'}
                  {item.status === 'duplicate' && 'Already added'}
                  {item.status === 'error' && 'Failed'}
                </span>
              </div>
              {item.status === 'uploading' ? (
                <div className="mt-2 h-1 w-full overflow-hidden bg-charcoal/10">
                  <div
                    className="h-full bg-pine transition-all"
                    style={{ width: `${item.percent}%` }}
                  />
                </div>
              ) : null}
              {item.error ? <p className="mt-1 text-xs text-red-600">{item.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {pendingCount > 0 ? (
        <p className="mt-3 text-center text-xs text-charcoal/55">
          By uploading, you understand these photos and videos will be visible to other event guests.
        </p>
      ) : null}

      {/* Only offered when a retry could actually change the outcome. A file
          rejected for its size or type keeps its message and is left alone. */}
      {retryable > 0 && !busy ? (
        <button
          type="button"
          onClick={retryFailed}
          className="spx-btn-outline mt-3 w-full"
        >
          Retry {retryable} failed file{retryable === 1 ? '' : 's'}
        </button>
      ) : null}

      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={startUpload}
          disabled={busy}
          className="spx-btn-ink mt-4 w-full disabled:opacity-50"
        >
          {busy ? 'Uploading…' : `Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
        </button>
      ) : null}

      {busy ? (
        <p className="mt-3 text-center text-xs text-charcoal/55">
          Keep this screen open until it finishes — the phone can&apos;t upload while it&apos;s
          locked or on another app.
        </p>
      ) : null}

      {successCount > 0 && !busy ? (
        <Notice tone="success" className="mt-4" label="Uploaded">
          {successCount} file{successCount === 1 ? '' : 's'} added. Thanks for sharing.
        </Notice>
      ) : null}

      {duplicateCount > 0 && !busy ? (
        <Notice className="mt-3" label="Skipped">
          {duplicateCount} file{duplicateCount === 1 ? '' : 's'} already in this event.
        </Notice>
      ) : null}
    </div>
  );
}
