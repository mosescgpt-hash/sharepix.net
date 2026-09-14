import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { FallbackImage } from '@/components/FallbackMedia';
import {
  decideProPhoto,
  fetchEventPhotos,
  fetchMyProConnections,
  processProPhoto,
  requestProUploadSlot,
  setProPublishing,
} from '@/lib/api';
import {
  DEFAULT_PREVIEW_LONG_EDGE,
  DEFAULT_PUBLISHING_MODE,
  PUBLISHING_MODES,
  isPublishingMode,
  type PublishStatus,
} from '@/lib/professionalMedia';
import type { DisplayPhoto } from '@/lib/types';

/**
 * The photographer's review queue.
 *
 * Built for somebody standing at the back of a reception with one hand free.
 * Large tiles, two decisions, and a count — not an admin table. The photograph
 * is the thing being judged, so it gets the space.
 *
 * Every button here is a request the server can refuse. The status machine is
 * in lib/professionalMedia.ts and re-checked in decide-pro-photo; this decides
 * which buttons to draw and nothing at all about what happens.
 */

type Queue = 'awaiting_review' | 'approved' | 'published' | 'rejected';

const QUEUES: Array<{ key: Queue; label: string }> = [
  { key: 'awaiting_review', label: 'To review' },
  { key: 'approved', label: 'Approved' },
  { key: 'published', label: 'Live' },
  { key: 'rejected', label: 'Rejected' },
];

export default function ProReviewPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : '';

  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [live, setLive] = useState(false);
  const [mode, setMode] = useState<string>(DEFAULT_PUBLISHING_MODE);
  const [queue, setQueue] = useState<Queue>('awaiting_review');
  const [phase, setPhase] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!eventId) return;
    const connections = await fetchMyProConnections().catch(() => []);
    const mine = connections.find((c) => c.eventId === eventId && c.status === 'accepted');
    if (!mine) {
      setPhase('denied');
      return;
    }
    setLive(mine.livePublishing);
    setMode(isPublishingMode(mine.publishingMode) ? mine.publishingMode : DEFAULT_PUBLISHING_MODE);
    setPhotos(await fetchEventPhotos(eventId, { useThumbs: true }).catch(() => []));
    setPhase('ready');
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(
    () => photos.filter((p) => (p as { sourceType?: string }).sourceType === 'professional'),
    [photos],
  );

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const photo of mine) {
      const status = (photo as { publishStatus?: string }).publishStatus ?? 'awaiting_review';
      out[status] = (out[status] ?? 0) + 1;
    }
    return out;
  }, [mine]);

  const shown = mine.filter(
    (p) => ((p as { publishStatus?: string }).publishStatus ?? 'awaiting_review') === queue,
  );

  /**
   * Send photographs straight from this page.
   *
   * The real client for this is the desktop uploader that does not exist yet;
   * this is the browser fallback, and it is also the only way to see the whole
   * path work today. Each file is a slot, a PUT, and a process call, in that
   * order — the same three steps the Bridge will make, so exercising this
   * exercises that.
   *
   * Sequential rather than parallel: a photographer on venue wifi pushing
   * thirty frames at once gets thirty stalled connections and no feedback. One
   * at a time is slower and finishes.
   */
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setMessage('');
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const slot = await requestProUploadSlot(eventId, file.type || 'image/jpeg');
        const put = await fetch(slot.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'image/jpeg' },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status}).`);
        // Separate call on purpose: the upload is done and the original is
        // safe at this point, so a processing failure is retryable rather than
        // a lost photograph.
        await processProPhoto(eventId, slot.uploadId);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : `${file.name} did not upload.`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    await load();
  }

  async function decide(uploadId: string, decision: string) {
    setBusy(uploadId);
    setMessage('');
    try {
      const result = await decideProPhoto(uploadId, decision);
      setMessage(result.message);
      // Re-read rather than patching in place: the server decides where a photo
      // lands (an approval publishes only when live), and guessing here would
      // show a state the database does not agree with.
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleLive() {
    setBusy('live');
    try {
      const result = await setProPublishing({ eventId, livePublishing: !live });
      setMessage(result.message);
      setLive(!live);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (phase === 'loading') {
    return (
      <Layout title="Review">
        <section className="spx-section-canvas">
          <p className="spx-body" role="status">
            Loading your queue…
          </p>
        </section>
      </Layout>
    );
  }

  if (phase === 'denied') {
    return (
      <Layout title="Review">
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-xl">
            <h1 className="mt-3">
              <span className="spx-display block">You are not on</span>
              <span className="spx-display-serif block">this event.</span>
            </h1>
            <p className="spx-body mt-5">
              A host has to add you before you can send photos to an event.{' '}
              <Link href="/pro" className="font-medium text-pine underline">
                Your events
              </Link>
            </p>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout title="Review" width="bleed">
      <section className="spx-section-canvas py-8">
        <div className="spx-inner">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="spx-eyebrow">SharePix Pro</p>
              <h1 className="spx-display mt-2 text-3xl sm:text-4xl">Review</h1>
            </div>
            {/* The control a photographer reaches for mid-ceremony, so it is
                the largest thing on the page after the photographs. */}
            <button
              type="button"
              onClick={() => void toggleLive()}
              disabled={busy === 'live'}
              className={`border px-5 py-3 text-sm font-semibold transition disabled:opacity-50 ${
                live
                  ? 'border-pine bg-pine text-white'
                  : 'border-charcoal/30 text-charcoal hover:border-charcoal/60'
              }`}
            >
              {live ? '● Live — publishing' : 'Paused — go live'}
            </button>
          </div>

          <p className="mt-3 max-w-xl text-sm text-charcoal/70">
            {live
              ? 'Photos you approve appear in the gallery straight away.'
              : 'Approve as much as you like — nothing reaches the gallery until you go live.'}
          </p>

          {message ? (
            <Notice tone="info" className="mt-4">
              {message}
            </Notice>
          ) : null}

          <div className="mt-6 border border-dashed border-charcoal/25 p-4">
            <label className="block">
              <span className="text-sm font-medium">Add photos</span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                onChange={(e) => {
                  void upload(e.target.files);
                  // Let the same file be chosen twice in a row.
                  e.target.value = '';
                }}
                className="mt-2 block w-full text-sm"
              />
            </label>
            <p className="mt-2 text-xs text-charcoal/55">
              JPEG or PNG. We make a {DEFAULT_PREVIEW_LONG_EDGE}px preview and delete your
              original unless you have asked us to keep it.
              {uploading > 0 ? ` Uploading ${uploading}…` : ''}
            </p>
          </div>

          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Queues">
            {QUEUES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setQueue(entry.key)}
                aria-current={queue === entry.key ? 'true' : undefined}
                className={`border px-4 py-2 text-sm font-medium transition ${
                  queue === entry.key
                    ? 'border-ink bg-ink text-canvas'
                    : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                }`}
              >
                {entry.label} ({counts[entry.key] ?? 0})
              </button>
            ))}
          </nav>

          {shown.length === 0 ? (
            <p className="mt-10 border border-dashed border-charcoal/25 p-10 text-center text-sm text-charcoal/60">
              Nothing here.
            </p>
          ) : (
            <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((photo) => {
                const status = ((photo as { publishStatus?: string }).publishStatus ??
                  'awaiting_review') as PublishStatus;
                const working = busy === photo.id;
                return (
                  <li key={photo.id} className="border border-charcoal/15">
                    <FallbackImage
                      source={{ primary: photo.url ?? '', fallback: photo.fallbackUrl ?? null }}
                      alt=""
                      className="aspect-[4/3] w-full bg-charcoal/5 object-cover"
                    />
                    <div className="flex flex-wrap gap-2 p-3">
                      {status === 'awaiting_review' ? (
                        <>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => void decide(photo.id, 'approve')}
                            className="spx-btn-ink flex-1 disabled:opacity-50"
                          >
                            {working ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => void decide(photo.id, 'reject')}
                            className="flex-1 border border-charcoal/25 px-4 py-2 text-sm font-medium transition hover:border-charcoal/60 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                      {status === 'approved' ? (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => void decide(photo.id, 'publish')}
                          className="spx-btn-ink flex-1 disabled:opacity-50"
                        >
                          {working ? '…' : 'Publish'}
                        </button>
                      ) : null}
                      {status === 'published' ? (
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => void decide(photo.id, 'unpublish')}
                          className="flex-1 border border-charcoal/25 px-4 py-2 text-sm font-medium transition hover:border-charcoal/60 disabled:opacity-50"
                        >
                          {working ? '…' : 'Take down'}
                        </button>
                      ) : null}
                      {/* Rejected is terminal. Un-rejecting is a deliberate
                          action with its own trail, not a button beside the
                          one that rejected it. */}
                      {status === 'rejected' ? (
                        <p className="text-xs text-charcoal/55">
                          Rejected — never shown to guests.
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="mt-10 border-t border-charcoal/15 pt-6">
            <label className="block max-w-sm">
              <span className="text-sm font-medium">When you approve a photo</span>
              <select
                value={mode}
                onChange={(e) => {
                  const next = e.target.value;
                  setMode(next);
                  void setProPublishing({ eventId, publishingMode: next });
                }}
                className="spx-input mt-2 w-full"
              >
                {PUBLISHING_MODES.map((option) => (
                  <option key={option} value={option}>
                    {option === 'approve_first'
                      ? 'Publish it (recommended)'
                      : option === 'auto_live'
                        ? 'Publish everything automatically'
                        : 'Hold it until I publish it'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>
    </Layout>
  );
}
