import { useEffect, useRef, useState } from 'react';
import {
  computeContentHash,
  fetchEventPhotoHashes,
  prepareEventUpload,
  uploadEventPhotoWithContext,
} from '@/lib/api';
import { keepScreenAwake } from '@/lib/wakeLock';
import {
  buildQueuedFiles,
  canStartUpload,
  countsOf,
  overallPercent,
  QueuedMedia,
  uploadPhase,
  UploadPhase,
} from '@/lib/uploadQueue';

interface UseMediaUploadArgs {
  eventId: string;
  allowVideo: boolean;
  videosRemaining: number | null;
  onUploaded?: () => void;
}

/**
 * All the guest-upload state and behaviour, extracted so the default form and
 * the themed TCC experience share ONE implementation. The upload/validation/
 * retry logic is exactly what UploadForm always ran; `removeFile` and
 * `clearPending` are additions the previews need and the default simply doesn't
 * call.
 */
export function useMediaUpload({ eventId, allowVideo, videosRemaining, onUploaded }: UseMediaUploadArgs) {
  const [queue, setQueue] = useState<QueuedMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [successCount, setSuccessCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [uploaderName, setUploaderName] = useState('');
  const idRef = useRef(0);

  useEffect(() => {
    setUploaderName(window.localStorage.getItem('sharepix-uploader-name') ?? '');
  }, []);

  function makeId(): string {
    idRef.current += 1;
    return `q${idRef.current}`;
  }

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

  function addFiles(files: File[]) {
    const next = buildQueuedFiles(files, queue, { allowVideo, videosRemaining }, makeId);
    setQueue((previous) => [...previous, ...next]);
    setSuccessCount(0);
    setDuplicateCount(0);
  }

  /** Remove one not-yet-uploaded item (ignored while a send is running). */
  function removeFile(id: string) {
    if (busy) return;
    setQueue((previous) => previous.filter((item) => item.id !== id));
  }

  /** Drop everything not already uploaded — used by "choose different photos". */
  function clearPending() {
    if (busy) return;
    setQueue((previous) => previous.filter((item) => item.status === 'done' || item.status === 'duplicate'));
    setSuccessCount(0);
    setDuplicateCount(0);
  }

  function updateItem(id: string, patch: Partial<QueuedMedia>) {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function upload() {
    setBusy(true);
    let uploaded = 0;
    let duplicates = 0;
    const uploadedBy = uploaderLabel();
    // Hold the screen awake for the whole run so a phone's auto-lock doesn't
    // interrupt an upload in progress. No-op where unsupported; released in the
    // finally below no matter how this exits.
    const wakeLock = await keepScreenAwake();

    try {
      let uploadContext: Awaited<ReturnType<typeof prepareEventUpload>>;
      try {
        uploadContext = await prepareEventUpload(eventId, uploadedBy);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The upload session could not be started.';
        setQueue((previous) => previous.map((item) =>
          item.status === 'pending' ? { ...item, status: 'error', error: message } : item,
        ));
        return;
      }

      // Hashes already in this event, plus hashes we upload during this run, so
      // we skip both photos already stored and the same file picked twice.
      const seenHashes = await fetchEventPhotoHashes(eventId);

      // Snapshot the pending items up front so removals mid-loop can't shift a
      // React-state index out from under us.
      const pending = queue.filter((item) => item.status === 'pending');
      for (const item of pending) {
        let hash: string | undefined;
        try {
          hash = (await computeContentHash(item.file)) ?? undefined;
        } catch {
          hash = undefined; // hashing failed — fall through and upload normally
        }
        if (hash && seenHashes.has(hash)) {
          updateItem(item.id, { status: 'duplicate', percent: 0 });
          duplicates += 1;
          continue;
        }

        updateItem(item.id, { status: 'uploading', percent: 0 });
        try {
          const photo = await uploadEventPhotoWithContext(
            uploadContext,
            item.file,
            ({ loaded, total }) => {
              updateItem(item.id, { percent: total ? Math.round((loaded / total) * 100) : 0 });
            },
            hash,
          );
          if (hash) seenHashes.add(hash);
          // Another guest can upload the same photo between our check and this
          // call; the server dedups it and tells us the record already existed.
          if (photo.duplicate) {
            updateItem(item.id, { status: 'duplicate', percent: 0 });
            duplicates += 1;
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

      setSuccessCount(uploaded);
      setDuplicateCount(duplicates);
      if (uploaded > 0) onUploaded?.();
    } finally {
      await wakeLock.release();
      setBusy(false);
    }
  }

  function retryFailed() {
    setQueue((previous) =>
      previous.map((item) =>
        item.status === 'error'
          ? { ...item, status: 'pending', percent: 0, error: undefined }
          : item,
      ),
    );
    setSuccessCount(0);
  }

  const counts = countsOf(queue);
  const phase: UploadPhase = uploadPhase(queue, busy);

  return {
    queue,
    busy,
    successCount,
    duplicateCount,
    uploaderName,
    setUploaderName,
    addFiles,
    removeFile,
    clearPending,
    upload,
    retryFailed,
    counts,
    phase,
    overall: overallPercent(queue),
    canUpload: canStartUpload(queue, busy),
  };
}

export type MediaUpload = ReturnType<typeof useMediaUpload>;
