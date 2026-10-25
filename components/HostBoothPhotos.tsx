import { useCallback, useEffect, useMemo, useState } from 'react';
import Notice from '@/components/Notice';
import BoothFixUp from '@/components/BoothFixUp';
import {
  decideProPhoto,
  fetchBoothStatus,
  processProPhoto,
  requestProUploadSlot,
  type BoothStatusView,
} from '@/lib/api';
import type { DisplayPhoto } from '@/lib/types';

/**
 * Booth photos on the host's own admin screen (docs/booth-mode.md). The host
 * sorts, approves and sends here; no photographer is needed. Upload goes
 * through the same QR-code matching a photographer's upload does, and
 * approving queues the same delivery email. The server re-checks every step:
 * only the event's host, or an admin, on a booth-mode event.
 */
export default function HostBoothPhotos({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<BoothStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchBoothStatus(eventId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booth photos could not be loaded.');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const photos = useMemo<DisplayPhoto[]>(() => {
    if (!status) return [];
    return [...status.assignments.entries()]
      .filter(([, a]) => a.publishStatus !== 'rejected')
      .sort(([, a], [, b]) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
      .map(([id, a]) => ({ id, eventId, url: a.thumbUrl ?? '' }) as unknown as DisplayPhoto);
  }, [status, eventId]);

  const approvedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [id, a] of status?.assignments ?? []) {
      if (a.publishStatus === 'approved') ids.add(id);
    }
    return ids;
  }, [status]);

  async function approve(ids: string[]) {
    let done = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await decideProPhoto(id, 'approve');
        done += 1;
      } catch {
        failed += 1;
      }
    }
    await load();
    return failed === 0
      ? { ok: true, message: `Approved ${done}. They are emailed within the hour.` }
      : { ok: false, message: `Approved ${done}; ${failed} could not be approved. Try again.` };
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMessage(null);
    const list = [...files];
    let failed = 0;
    for (const [i, file] of list.entries()) {
      setUploading(`Uploading ${i + 1} of ${list.length}…`);
      try {
        const slot = await requestProUploadSlot(eventId, file.type || 'image/jpeg');
        const put = await fetch(slot.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'image/jpeg' },
        });
        if (!put.ok) throw new Error('upload failed');
        await processProPhoto(eventId, slot.uploadId);
      } catch {
        failed += 1;
      }
    }
    setUploading(null);
    setMessage(
      failed
        ? `${list.length - failed} uploaded; ${failed} did not. Try those again.`
        : `${list.length} uploaded and sorted by the QR codes.`,
    );
    await load();
  }

  return (
    <div className="spx-card mt-6 p-6" id="booth-photos">
      <p className="spx-eyebrow">Booth photos</p>
      <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.02em]">
        Sort, approve and send
      </h2>
      <p className="spx-body mt-2 text-sm">
        Upload your booth photos in the order they were taken, with each person&apos;s QR code
        shot first. We sort them by person. Check each person&apos;s photos, fix any that
        landed in the wrong place, then approve. Approved photos are emailed to that person
        within the hour.
      </p>
      <label className="spx-btn-ink mt-4 inline-block cursor-pointer">
        {uploading ?? 'Upload booth photos'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif"
          multiple
          className="sr-only"
          disabled={Boolean(uploading)}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {message ? <Notice tone="info">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {status && photos.length === 0 ? (
        <p className="spx-body mt-4 text-sm">No booth photos yet.</p>
      ) : null}
      {status && photos.length > 0 ? (
        <BoothFixUp
          eventId={eventId}
          photos={photos}
          status={status}
          onChange={() => void load()}
          approvedIds={approvedIds}
          onApprove={approve}
        />
      ) : null}
    </div>
  );
}
