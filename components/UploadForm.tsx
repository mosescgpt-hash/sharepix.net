import { ChangeEvent, useEffect, useState } from 'react';
import { uploadEventPhoto } from '@/lib/api';
import { validateMediaFile } from '@/lib/validation';

interface UploadFormProps {
  eventId: string;
  onUploaded?: () => void;
}

type FileStatus = 'pending' | 'uploading' | 'done' | 'error';

interface QueuedFile {
  file: File;
  status: FileStatus;
  percent: number;
  error?: string;
}

export default function UploadForm({ eventId, onUploaded }: UploadFormProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
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
      const problem = validateMediaFile(file);
      return problem
        ? { file, status: 'error', percent: 0, error: problem }
        : { file, status: 'pending', percent: 0 };
    });
    setQueue((previous) => [...previous, ...next]);
    setSuccessCount(0);
    e.target.value = '';
  }

  function updateItem(index: number, patch: Partial<QueuedFile>) {
    setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleUpload() {
    setBusy(true);
    let uploaded = 0;
    const uploadedBy = uploaderLabel();

    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      if (item.status !== 'pending') continue;

      updateItem(i, { status: 'uploading', percent: 0 });
      try {
        await uploadEventPhoto(eventId, item.file, ({ loaded, total }) => {
          updateItem(i, { percent: total ? Math.round((loaded / total) * 100) : 0 });
        }, uploadedBy);
        updateItem(i, { status: 'done', percent: 100 });
        uploaded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed. Check your connection and try again.';
        updateItem(i, { status: 'error', error: message });
      }
    }

    setBusy(false);
    setSuccessCount(uploaded);
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
          {queue.map((item, i) => (
            <li key={`${item.file.name}-${i}`} className="rounded-lg bg-smoke px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{item.file.name}</span>
                <span className="shrink-0 text-xs text-ink/60">
                  {item.status === 'pending' && 'Ready'}
                  {item.status === 'uploading' && `${item.percent}%`}
                  {item.status === 'done' && '✓ Uploaded'}
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
    </div>
  );
}
