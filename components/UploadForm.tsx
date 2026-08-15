import { ChangeEvent, useEffect, useState } from 'react';
import {
  computeContentHash,
  fetchEventPhotoHashes,
  prepareEventUpload,
  uploadEventPhotoWithContext,
} from '@/lib/api';
import { MAX_VIDEO_SIZE_LABEL, validateMediaFile } from '@/lib/validation';

interface UploadFormProps {
  eventId: string;
  onUploaded?: () => void;
  /** False when the host has turned video off for this event. */
  allowVideo?: boolean;
}

type FileStatus = 'pending' | 'uploading' | 'done' | 'error' | 'duplicate';

interface QueuedFile {
  file: File;
  status: FileStatus;
  percent: number;
  error?: string;
}

export default function UploadForm({
  eventId,
  onUploaded,
  allowVideo = true,
}: UploadFormProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [uploaderName, setUploaderName] = useState('');

  useEffect(() => {
    setUploaderName(window.localStorage.getItem('sharepix-uploader-name') ?? '');
  }, []);

  function uploaderLabel(): string {
    const entered = uploaderName.trim().slice(0, 60);
    if (entered) {
      window.localStorage.setItem('sharepix-uploader-name', entered);
      return entered;
    }

    const savedLabel = window.localStorage.getItem('sharepix-guest-label');
    if (savedLabel) return savedLabel;
    const label = `Guest ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    window.localStorage.setItem('sharepix-guest-label', label);
    return label;
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const next: QueuedFile[] = files.map((file) => {
      const problem = validateMediaFile(file, { allowVideo });
      return problem
        ? { file, status: 'error', percent: 0, error: problem }
        : { file, status: 'pending', percent: 0 };
    });
    setQueue((previous) => [...previous, ...next]);
    setSuccessCount(0);
    setDuplicateCount(0);
    e.target.value = '';
  }

  function updateItem(index: number, patch: Partial<QueuedFile>) {
    setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleUpload() {
    setBusy(true);
    let uploaded = 0;
    let duplicates = 0;
    const uploadedBy = uploaderLabel();
    let uploadContext: Awaited<ReturnType<typeof prepareEventUpload>>;

    try {
      uploadContext = await prepareEventUpload(eventId, uploadedBy);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The upload session could not be started.';
      setQueue((previous) => previous.map((item) =>
        item.status === 'pending' ? { ...item, status: 'error', error: message } : item,
      ));
      setBusy(false);
      return;
    }

    // Hashes already in this event, plus hashes we upload during this run, so we
    // skip both photos already stored and the same file picked twice in a batch.
    const seenHashes = await fetchEventPhotoHashes(eventId);

    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      if (item.status !== 'pending') continue;

      // Fingerprint the file and skip it if an identical one is already here.
      // A null hash (file too big to hash, or hashing failed) is not an error —
      // it just means this one uploads without the duplicate check.
      let hash: string | undefined;
      try {
        hash = (await computeContentHash(item.file)) ?? undefined;
      } catch {
        hash = undefined; // hashing failed — fall through and upload normally
      }
      if (hash && seenHashes.has(hash)) {
        updateItem(i, { status: 'duplicate', percent: 0 });
        duplicates += 1;
        continue;
      }

      updateItem(i, { status: 'uploading', percent: 0 });
      try {
        const photo = await uploadEventPhotoWithContext(
          uploadContext,
          item.file,
          ({ loaded, total }) => {
            updateItem(i, { percent: total ? Math.round((loaded / total) * 100) : 0 });
          },
          hash,
        );
        if (hash) seenHashes.add(hash);
        // Another guest can upload the same photo between our check and this
        // call; the server dedups it and tells us the record already existed.
        if (photo.duplicate) {
          updateItem(i, { status: 'duplicate', percent: 0 });
          duplicates += 1;
        } else {
          updateItem(i, { status: 'done', percent: 100 });
          uploaded += 1;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : '';
        const message = /rate exceeded|throttl|no current user/i.test(rawMessage)
          ? 'The service was busy. Use Retry failed files, then tap Upload again.'
          : rawMessage || 'Upload failed. Check your connection and try again.';
        updateItem(i, { status: 'error', error: message });
      }
    }

    setBusy(false);
    setSuccessCount(uploaded);
    setDuplicateCount(duplicates);
    if (uploaded > 0) onUploaded?.();
  }

  function handleRetryFailed() {
    setQueue((previous) =>
      previous.map((item) =>
        item.status === 'error'
          ? { ...item, status: 'pending', percent: 0, error: undefined }
          : item,
      ),
    );
    setSuccessCount(0);
  }

  const pendingCount = queue.filter((q) => q.status === 'pending').length;
  const failedCount = queue.filter((q) => q.status === 'error').length;

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5">
      <label htmlFor="uploader-name" className="mb-4 block">
        <span className="text-sm font-medium">Your name or nickname (optional)</span>
        <input
          id="uploader-name"
          type="text"
          value={uploaderName}
          maxLength={60}
          onChange={(event) => setUploaderName(event.target.value)}
          placeholder="Example: Aunt Maya"
          className="mt-1.5 w-full rounded-lg border border-ink/20 px-3 py-2.5 outline-none focus:border-accent"
        />
        <span className="mt-1 block text-xs text-ink/50">
          This helps everyone sort by uploader. If left blank, this browser gets a reusable guest label.
        </span>
      </label>
      <div className="rounded-xl border-2 border-dashed border-ink/20 px-4 py-6 text-center">
        <span className="text-3xl" aria-hidden>📷</span>
        <p className="mt-2 font-medium">Add photos or videos</p>
        <p className="mt-1 text-sm text-ink/60">
          Photos up to 25 MB · MP4, MOV, or WEBM videos up to {MAX_VIDEO_SIZE_LABEL}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label
            htmlFor="photo-camera-input"
            className="cursor-pointer rounded-full bg-accent px-4 py-3 font-medium text-white hover:bg-accent/90"
          >
            Camera
          </label>
          <label
            htmlFor="photo-library-input"
            className="cursor-pointer rounded-full border border-ink/20 bg-white px-4 py-3 font-medium text-ink hover:border-accent"
          >
            Choose from device
          </label>
        </div>
      </div>
      {/* Camera capture needs a SINGLE simple accept value. Android Chrome only
          launches the camera when `capture` is paired with one plain type like
          "image/*" — give it a list (image/*,video/*,.heic,...) and it gives up
          and opens the file picker instead, which is why this opened the gallery
          on a Pixel while iOS still honoured it. Extensions are pointless here
          anyway: the camera returns whatever the OS produces, not a file the
          user picked.

          One accept value means one mode, and this is deliberately the photo
          one: a guest snapping a picture at a reception is the common case, and
          this way it works the same on every phone. Recording still reaches us
          through the picker below — guests film in their own camera app, which
          is what they do anyway, then choose the clip. */}
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

      {queue.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {queue.map((item, i) => (
            <li key={`${item.file.name}-${i}`} className="rounded-lg bg-smoke px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{item.file.name}</span>
                <span className="shrink-0 text-xs text-ink/60">
                  {item.status === 'pending' && 'Ready'}
                  {item.status === 'uploading' && `${item.percent}%`}
                  {item.status === 'done' && '✓ Uploaded'}
                  {item.status === 'duplicate' && 'Already added'}
                  {item.status === 'error' && 'Failed'}
                </span>
              </div>
              {item.status === 'uploading' ? (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-ink/10">
                  <div
                    className="h-full bg-accent transition-all"
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
        <p className="mt-3 text-center text-xs text-ink/50">
          By uploading, you understand these photos and videos will be visible to other event guests.
        </p>
      ) : null}

      {failedCount > 0 && !busy ? (
        <button
          type="button"
          onClick={handleRetryFailed}
          className="mt-3 w-full rounded-full border border-ink/20 bg-white py-2.5 font-medium text-ink hover:border-accent"
        >
          Retry {failedCount} failed file{failedCount === 1 ? '' : 's'}
        </button>
      ) : null}

      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={handleUpload}
          disabled={busy}
          className="mt-4 w-full rounded-full bg-ink py-3 font-medium text-white hover:bg-night disabled:opacity-50"
        >
          {busy ? 'Uploading…' : `Upload ${pendingCount} file${pendingCount === 1 ? '' : 's'}`}
        </button>
      ) : null}

      {successCount > 0 && !busy ? (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-center text-sm text-green-700">
          {successCount} file{successCount === 1 ? '' : 's'} uploaded. Thanks for sharing! 🎉
        </p>
      ) : null}

      {duplicateCount > 0 && !busy ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
          Skipped {duplicateCount} file{duplicateCount === 1 ? '' : 's'} already in this event.
        </p>
      ) : null}
    </div>
  );
}
