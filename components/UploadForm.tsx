import { ChangeEvent, useState } from 'react';
import { uploadEventPhoto } from '@/lib/api';
import { validateImageFile } from '@/lib/validation';

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

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const next: QueuedFile[] = files.map((file) => {
      const problem = validateImageFile(file);
      return problem
        ? { file, status: 'error', percent: 0, error: problem }
        : { file, status: 'pending', percent: 0 };
    });
    setQueue(next);
    setSuccessCount(0);
    e.target.value = '';
  }

  function updateItem(index: number, patch: Partial<QueuedFile>) {
    setQueue((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function handleUpload() {
    setBusy(true);
    let uploaded = 0;

    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      if (item.status !== 'pending') continue;

      updateItem(i, { status: 'uploading', percent: 0 });
      try {
        await uploadEventPhoto(eventId, item.file, ({ loaded, total }) => {
          updateItem(i, { percent: total ? Math.round((loaded / total) * 100) : 0 });
        });
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

  const pendingCount = queue.filter((q) => q.status === 'pending').length;

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5">
      <label
        htmlFor="photo-input"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink/20 px-4 py-10 text-center hover:border-accent"
      >
        <span className="text-3xl" aria-hidden>📷</span>
        <span className="font-medium">Tap to choose photos</span>
        <span className="text-sm text-ink/60">JPG, PNG, GIF, WEBP, or HEIC · up to 25 MB each</span>
      </label>
      <input
        id="photo-input"
        type="file"
        accept="image/*"
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
          By uploading, you understand these photos will be visible to other event guests.
        </p>
      ) : null}

      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={handleUpload}
          disabled={busy}
          className="mt-4 w-full rounded-full bg-ink py-3 font-medium text-white hover:bg-night disabled:opacity-50"
        >
          {busy ? 'Uploading…' : `Upload ${pendingCount} photo${pendingCount === 1 ? '' : 's'}`}
        </button>
      ) : null}

      {successCount > 0 && !busy ? (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-center text-sm text-green-700">
          {successCount} photo{successCount === 1 ? '' : 's'} uploaded. Thanks for sharing! 🎉
        </p>
      ) : null}
    </div>
  );
}
