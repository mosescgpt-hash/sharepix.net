import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  fetchEventPhotoHashes,
  prepareEventUpload,
  uploadEventPhotoWithContext,
} from '@/lib/api';
import { classifyDuplicate, duplicateMessage, hashFileContent } from '@/lib/hash';
import { validateMediaFile } from '@/lib/validation';

interface UploadFormProps {
  eventId: string;
  onUploaded?: () => void;
}

type FileStatus = 'checking' | 'pending' | 'uploading' | 'done' | 'duplicate' | 'error';

interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  percent: number;
  error?: string;
  /** SHA-256 of the file, null when this browser couldn't hash it. */
  hash?: string | null;
}

export default function UploadForm({ eventId, onUploaded }: UploadFormProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [uploaderName, setUploaderName] = useState('');

  // Hashes of what the gallery already holds, and of what is already queued.
  // Both are refs because the hashing pass reads them between renders.
  const galleryHashes = useRef<Set<string>>(new Set());
  const queuedHashes = useRef<Set<string>>(new Set());
  const galleryHashesReady = useRef<Promise<unknown> | null>(null);
  const nextFileId = useRef(0);

  useEffect(() => {
    setUploaderName(window.localStorage.getItem('sharepix-uploader-name') ?? '');
  }, []);

  useEffect(() => {
    galleryHashes.current = new Set();
    galleryHashesReady.current = fetchEventPhotoHashes(eventId).then((hashes) => {
      galleryHashes.current = hashes;
    });
  }, [eventId]);

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

  function updateItem(id: string, patch: Partial<QueuedFile>) {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  /**
   * Hash each newly picked file and mark the ones this gallery (or this batch)
   * has already seen, so they never reach the network. Files are hashed one at
   * a time to keep a phone from holding several large videos in memory at once.
   */
  async function inspectFiles(items: QueuedFile[]) {
    await galleryHashesReady.current?.catch(() => undefined);

    for (const item of items) {
      const hash = await hashFileContent(item.file);
      const kind = classifyDuplicate(hash, galleryHashes.current, queuedHashes.current);

      if (kind === 'none') {
        if (hash) queuedHashes.current.add(hash);
        updateItem(item.id, { status: 'pending', hash });
      } else {
        updateItem(item.id, { status: 'duplicate', hash, error: duplicateMessage(kind) ?? undefined });
      }
    }
  }

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    const added: QueuedFile[] = files.map((file) => {
      const id = `file-${(nextFileId.current += 1)}`;
      const problem = validateMediaFile(file);
      return problem
        ? { id, file, status: 'error' as const, percent: 0, error: problem }
        : { id, file, status: 'checking' as const, percent: 0 };
    });

    setQueue((previous) => [...previous, ...added]);
    setSuccessCount(0);
    setSkippedCount(0);
    void inspectFiles(added.filter((item) => item.status === 'checking'));
  }

  async function handleUpload() {
    setBusy(true);
    let uploaded = 0;
    let skipped = 0;
    const uploadedBy = uploaderLabel();
    const targets = queue.filter((item) => item.status === 'pending');
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

    for (const item of targets) {
      updateItem(item.id, { status: 'uploading', percent: 0 });
      try {
        const photo = await uploadEventPhotoWithContext(
          uploadContext,
          item.file,
          ({ loaded, total }) => {
            updateItem(item.id, { percent: total ? Math.round((loaded / total) * 100) : 0 });
          },
          item.hash,
        );

        if (item.hash) galleryHashes.current.add(item.hash);

        // Another guest can upload the same picture between the check above and
        // this call; the server hands back the record it already had.
        if (photo.duplicate) {
          skipped += 1;
          updateItem(item.id, {
            status: 'duplicate',
            percent: 0,
            error: duplicateMessage('gallery') ?? undefined,
          });
        } else {
          updateItem(item.id, { status: 'done', percent: 100 });
          uploaded += 1;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : '';
        const message = /rate exceeded|throttl|no current user/i.test(rawMessage)
          ? 'The service was busy. Use Retry failed files, then tap Upload again.'
          : rawMessage || 'Upload failed. Check your connection and try again.';
        updateItem(item.id, { status: 'error', error: message });
      }
    }

    setBusy(false);
    setSuccessCount(uploaded);
    setSkippedCount(skipped);
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
    setSkippedCount(0);
  }

  const pendingCount = queue.filter((q) => q.status === 'pending').length;
  const failedCount = queue.filter((q) => q.status === 'error').length;
  const checkingCount = queue.filter((q) => q.status === 'checking').length;
  const duplicateCount = queue.filter((q) => q.status === 'duplicate').length;

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
          Photos up to 25 MB · MP4, MOV, or WEBM videos up to 100 MB
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label
            htmlFor="photo-camera-input"
            className="cursor-pointer rounded-full bg-accent px-4 py-3 font-medium text-white hover:bg-accent/90"
          >
            Use camera
          </label>
          <label
            htmlFor="photo-library-input"
            className="cursor-pointer rounded-full border border-ink/20 bg-white px-4 py-3 font-medium text-ink hover:border-accent"
          >
            Choose from device
          </label>
        </div>
      </div>
      <input
        id="photo-camera-input"
        type="file"
        accept="image/*,video/*,.heic,.heif,.mov,.m4v"
        capture="environment"
        className="sr-only"
        onChange={handleFileSelect}
      />
      <input
        id="photo-library-input"
        type="file"
        accept="image/*,video/*,.heic,.heif,.mov,.m4v"
        multiple
        className="sr-only"
        onChange={handleFileSelect}
      />

      {queue.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {queue.map((item) => (
            <li key={item.id} className="rounded-lg bg-smoke px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate ${item.status === 'duplicate' ? 'text-ink/50' : ''}`}>
                  {item.file.name}
                </span>
                <span className="shrink-0 text-xs text-ink/60">
                  {item.status === 'checking' && 'Checking…'}
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
              {item.error ? (
                <p className={`mt-1 text-xs ${item.status === 'duplicate' ? 'text-ink/50' : 'text-red-600'}`}>
                  {item.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {checkingCount > 0 ? (
        <p className="mt-3 text-center text-xs text-ink/50">
          Checking {checkingCount} file{checkingCount === 1 ? '' : 's'} against what this gallery already has…
        </p>
      ) : null}

      {duplicateCount > 0 && !busy ? (
        <p className="mt-3 rounded-lg bg-smoke px-3 py-2 text-center text-sm text-ink/60">
          {duplicateCount} file{duplicateCount === 1 ? ' was' : 's were'} already in this gallery and
          won&apos;t be uploaded again.
        </p>
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
          disabled={busy || checkingCount > 0}
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

      {skippedCount > 0 && !busy ? (
        <p className="mt-3 rounded-lg bg-smoke px-3 py-2 text-center text-sm text-ink/60">
          {skippedCount} file{skippedCount === 1 ? '' : 's'} someone else had already added.
        </p>
      ) : null}
    </div>
  );
}
