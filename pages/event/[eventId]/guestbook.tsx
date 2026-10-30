import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import GuestReferralLink from '@/components/GuestReferralLink';
import Layout from '@/components/Layout';
import GuestBookAlbum from '@/components/GuestBookAlbum';
import Notice from '@/components/Notice';
import { isVideoFilename, MAX_VIDEO_SIZE_LABEL, validateMediaFile } from '@/lib/validation';
import {
  fetchEvent,
  fetchEventPhotos,
  fetchGuestBook,
  prepareEventUpload,
  signGuestBook,
} from '@/lib/api';
import { useMediaUpload } from '@/hooks/useMediaUpload';
import { videosRemaining } from '@/lib/pricing';
import {
  GUEST_BOOK_CONSENT_LINE,
  GUEST_BOOK_VIDEO_CONSENT_LINE,
  attachmentFailureMessage,
  attachmentKind,
  noteFailureMessage,
  postSubmitNotice,
} from '@/lib/guestBookAttach';
import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  guestBookAvailable,
} from '@/lib/guestBook';
import type { DisplayPhoto, GuestBookEntry, QREvent } from '@/lib/types';

export default function GuestBookPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [entries, setEntries] = useState<GuestBookEntry[]>([]);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [photoId, setPhotoId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<'shown' | 'pending' | null>(null);
  const [doneNotice, setDoneNotice] = useState<string | null>(null);

  // The photo or video chosen in the form. It is uploaded when the guest taps
  // Sign, through the same hook the upload page uses (one upload path), and the
  // id it comes back with is what the note is signed with.
  const [staged, setStaged] = useState<File | null>(null);
  const attachedIdRef = useRef<string | null>(null);
  const [attachedId, setAttachedId] = useState<string | null>(null);
  // requested -> uploading -> settled -> idle. The upload hook reads its queue
  // from the render it was called in, so each step waits for the render that
  // holds the state it needs instead of racing it.
  const [phase, setPhase] = useState<'idle' | 'requested' | 'uploading' | 'settled'>('idle');
  const warmedRef = useRef(false);

  const allowVideo = event?.videoUploadsEnabled !== false;
  const videoSlots = event ? videosRemaining(event) : null;
  const videoOffered = allowVideo && videoSlots !== 0;
  const media = useMediaUpload({
    eventId: eventId ?? '',
    allowVideo,
    videosRemaining: videoSlots,
    // Also fires for a file the event already held (duplicate), with the
    // existing photo's id, so a repeated picture still attaches.
    onPhotoUploaded: (info) => {
      attachedIdRef.current = info.id;
      setAttachedId(info.id);
    },
  });

  const load = useCallback(async () => {
    if (!eventId) return;
    const found = await fetchEvent(eventId);
    if (!found) {
      setError('We couldn’t find that event. Double-check the QR code or link.');
      return;
    }
    setEvent(found);
    if (!guestBookAvailable(found)) return;

    // The album's own entries, plus the event's photos so an attached one can
    // be shown. Photos are already signed for both R2 and S3 by fetchEventPhotos.
    const [book, eventPhotos] = await Promise.all([
      fetchGuestBook(eventId),
      fetchEventPhotos(eventId).catch(() => [] as DisplayPhoto[]),
    ]);
    setEntries(book);
    setPhotos(eventPhotos);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    load()
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading the guest book.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, load]);

  const photosById = useMemo(() => {
    const map = new Map<string, DisplayPhoto>();
    for (const photo of photos) map.set(photo.id, photo);
    return map;
  }, [photos]);

  // Only media this guest can actually attach: everything visible in the event.
  const attachable = useMemo(() => photos.slice(0, 60), [photos]);

  const available = guestBookAvailable(event);

  const stagedKind = staged ? attachmentKind(staged) : null;

  function resetAttachment() {
    attachedIdRef.current = null;
    setAttachedId(null);
    setStaged(null);
    media.clearPending();
  }

  function stageFile(input: ChangeEvent<HTMLInputElement>) {
    const file = input.target.files?.[0];
    // Cleared so picking the same file again after removing it still fires.
    input.target.value = '';
    if (!file || saving) return;
    attachedIdRef.current = null;
    setAttachedId(null);
    media.clearPending();
    const problem = validateMediaFile(file, { allowVideo });
    if (problem) {
      setStaged(null);
      setFormError(problem);
      return;
    }
    setFormError(null);
    setStaged(file);
    // Warm the guest Cognito session now, while they are still writing, so the
    // first upload does not go out unsigned. prepareEventUpload is what the
    // upload page runs first; it is best-effort here and runs again at upload.
    if (!warmedRef.current && eventId) {
      warmedRef.current = true;
      prepareEventUpload(eventId, name).catch(() => {
        warmedRef.current = false;
      });
    }
  }

  async function finishSign(attachId: string | null) {
    if (!eventId) return;
    try {
      const result = await signGuestBook({
        eventId,
        name,
        message,
        photoId: attachId || photoId || null,
      });
      setDone(result.pending ? 'pending' : 'shown');
      setDoneNotice(
        postSubmitNotice({
          pending: result.pending,
          attached: attachId ? stagedKind : null,
          moderationMode: event?.moderationMode,
        }),
      );
      setName('');
      setMessage('');
      setPhotoId('');
      resetAttachment();
      // A held note is not in the album yet, so only reload when it will show.
      if (!result.pending) await load();
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'We could not save that note.';
      // The file is already in the event. Keep its id so the next tap signs
      // with it instead of uploading it again.
      setFormError(attachId && stagedKind ? noteFailureMessage(stagedKind, detail) : detail);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    if (!eventId || saving) return;
    setSaving(true);
    setFormError(null);
    setDone(null);
    setDoneNotice(null);
    if (staged && !attachedIdRef.current) {
      // The gallery shows who uploaded a file, so use the name they signed with.
      media.setUploaderName(name);
      if (media.retryable > 0) media.retryFailed();
      else if (media.counts.pending === 0) media.addFiles([staged]);
      setPhase('requested');
      return;
    }
    await finishSign(attachedIdRef.current);
  }

  // Step 2: the queue now holds the file, so start the upload.
  useEffect(() => {
    if (phase !== 'requested' || media.busy) return;
    if (media.counts.pending > 0) {
      setPhase('uploading');
      void media.upload().then(() => setPhase('settled'));
      return;
    }
    // The queue refused it (a size, type or video-slot rule). Nothing uploaded.
    setPhase('settled');
  });

  // Step 3: the upload has ended, successfully or not.
  useEffect(() => {
    if (phase !== 'settled') return;
    setPhase('idle');
    const id = attachedIdRef.current;
    if (id) {
      void finishSign(id);
      return;
    }
    const failed = media.queue.find((item) => item.status === 'error');
    if (failed?.permanent) {
      // A rule it can never pass (size, type, no video slots left). Drop it so
      // the guest can pick another file or sign without one.
      setFormError(
        `${failed.error ?? 'That file cannot be added.'} Your note is still here — choose a different file, or sign without one.`,
      );
      resetAttachment();
    } else {
      // Transient: keep the file staged and put it back in line, so tapping
      // Sign again retries the upload.
      setFormError(attachmentFailureMessage(stagedKind ?? 'photo', failed?.error));
      media.retryFailed();
    }
    setSaving(false);
  });

  return (
    <Layout title={event ? `${event.name} guest book` : 'Guest book'} width="bleed">
      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="mx-auto w-full max-w-2xl">
        {loading ? (
          <p className="spx-body text-center">Loading the guest book&hellip;</p>
        ) : error ? (
          <Notice tone="error">{error}</Notice>
        ) : !event ? null : !available ? (
          <div className="spx-empty">
            <p className="spx-display-serif text-2xl">No guest book here.</p>
            <p className="spx-body mt-2 max-w-sm text-sm">
              The host can add one from their dashboard. In the meantime you can still add
              your photos.
            </p>
            <Link href={`/event/${event.id}/upload`} className="spx-btn-ink mt-6">
              Add your photos
            </Link>
          </div>
        ) : (
          <>
            <div>
              <p className="spx-eyebrow">Guest book</p>
              <h1 className="mt-3">
                <span className="spx-display block">{event.name}</span>
                <span className="spx-display-serif block">Sign the book.</span>
              </h1>
              <p className="spx-body mt-4 max-w-md">
                Leave a note for the host — and add one of your photos or a video message if
                you like.
              </p>
            </div>

            {/* The form sits above the album: a guest arriving from the QR code
                came to sign it, not to read it. */}
            <form onSubmit={handleSubmit} className="spx-card mt-10 p-6 sm:p-8">
              {/* role="status" rather than Notice's role="alert": this is
                  confirmation of something the guest just did, so it should be
                  announced politely rather than interrupt. */}
              {done ? (
                <div role="status" className="mb-6">
                  <Notice
                    tone={done === 'pending' ? 'info' : 'success'}
                    label={done === 'pending' ? 'With the host' : 'Signed'}
                  >
                    {doneNotice ??
                      (done === 'pending'
                        ? 'Thank you — your note is with the host and will appear once they approve it.'
                        : 'Thank you — your note is in the book below.')}
                  </Notice>
                </div>
              ) : null}

              <label htmlFor="gb-name" className="block font-sans text-sm font-medium text-charcoal">
                Your name
              </label>
              <input
                id="gb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_NAME_LENGTH}
                required
                autoComplete="name"
                placeholder="Maya Patel"
                className="spx-input mt-2"
              />

              <label htmlFor="gb-message" className="mt-5 block font-sans text-sm font-medium text-charcoal">
                Your note
              </label>
              <textarea
                id="gb-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={5}
                placeholder="What a day. So happy for you both."
                className="spx-input mt-2"
              />
              <p className="mt-1 text-right text-xs text-charcoal/70">
                {message.length} / {MAX_MESSAGE_LENGTH}
              </p>

              <div className="mt-5">
                <p className="font-sans text-sm font-medium text-charcoal">
                  Add a photo{videoOffered ? ' or a video message' : ''}{' '}
                  <span className="text-charcoal/70">(optional)</span>
                </p>
                <div className={`mt-2 grid gap-3 ${videoOffered ? 'sm:grid-cols-2' : ''}`}>
                  <label
                    htmlFor="gb-add-photo"
                    className={`spx-btn-outline cursor-pointer ${saving ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    Add a photo
                  </label>
                  {videoOffered ? (
                    <label
                      htmlFor="gb-add-video"
                      className={`spx-btn-outline cursor-pointer ${saving ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      Record a video message
                    </label>
                  ) : null}
                </div>
                {/* Photos: no `capture`, so a phone offers camera and library.
                    Video: `capture` opens the phone's own camera app. */}
                <input
                  id="gb-add-photo"
                  type="file"
                  accept="image/*,.heic,.heif"
                  className="sr-only"
                  disabled={saving}
                  onChange={stageFile}
                />
                {videoOffered ? (
                  <input
                    id="gb-add-video"
                    type="file"
                    accept="video/*,.mov,.m4v"
                    capture="user"
                    className="sr-only"
                    disabled={saving}
                    onChange={stageFile}
                  />
                ) : null}

                {staged ? (
                  <div className="mt-3 border border-charcoal/10 bg-sand/60 px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {stagedKind === 'video' ? 'Video' : 'Photo'}: {staged.name}
                      </span>
                      <span className="shrink-0 text-xs text-charcoal/70">
                        {attachedId
                          ? '✓ Uploaded'
                          : media.busy
                            ? `${media.overall}%`
                            : 'Ready'}
                      </span>
                    </div>
                    {media.busy ? (
                      <div className="mt-2 h-1 w-full overflow-hidden bg-charcoal/10">
                        <div
                          className="h-full bg-pine transition-all"
                          style={{ width: `${media.overall}%` }}
                        />
                      </div>
                    ) : null}
                    {!saving ? (
                      <button
                        type="button"
                        onClick={() => {
                          resetAttachment();
                          setFormError(null);
                        }}
                        className="mt-2 text-xs text-pine underline"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* The same consent sentence the upload page shows, said where
                    the guest is about to attach something. */}
                <p className="mt-3 text-xs text-charcoal/70">{GUEST_BOOK_CONSENT_LINE}</p>
                {videoOffered ? (
                  <p className="mt-1 text-xs text-charcoal/70">
                    {GUEST_BOOK_VIDEO_CONSENT_LINE} Videos up to {MAX_VIDEO_SIZE_LABEL}.
                  </p>
                ) : null}
              </div>

              {attachable.length > 0 ? (
                <>
                  <label htmlFor="gb-photo" className="mt-4 block font-sans text-sm font-medium text-charcoal">
                    Attach one of your photos or videos <span className="text-charcoal/70">(optional)</span>
                  </label>
                  <select
                    id="gb-photo"
                    value={photoId}
                    onChange={(e) => setPhotoId(e.target.value)}
                    disabled={staged !== null}
                    className="spx-input mt-2"
                  >
                    <option value="">No attachment</option>
                    {attachable.map((photo, i) => (
                      <option key={photo.id} value={photo.id}>
                        {isVideoFilename(photo.s3Key) ? 'Video' : 'Photo'} {i + 1}
                        {photo.uploadedBy ? ` — ${photo.uploadedBy}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-charcoal/70">
                    Haven&apos;t uploaded yet?{' '}
                    <Link href={`/event/${event.id}/upload`} className="text-pine underline">
                      Add your photos first
                    </Link>
                    , then come back and attach one.
                  </p>
                  {staged ? (
                    <p className="mt-1 text-xs text-charcoal/70">
                      The {stagedKind === 'video' ? 'video' : 'photo'} you just added will be
                      attached instead.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-4 text-xs text-charcoal/70">
                  <Link href={`/event/${event.id}/upload`} className="text-pine underline">
                    Add a photo or a video message
                  </Link>{' '}
                  to attach one to your note.
                </p>
              )}

              {formError ? (
                <Notice tone="error" className="mt-4">
                  {formError}
                </Notice>
              ) : null}

              <button
                type="submit"
                disabled={saving}
                className="spx-btn-ink mt-6 w-full disabled:opacity-60"
              >
                {saving ? (media.busy ? 'Uploading…' : 'Signing…') : 'Sign the guest book'}
              </button>
            </form>

            <div className="mt-14">
              <GuestBookAlbum
                entries={entries}
                mediaFor={(id) => {
                  const photo = photosById.get(id);
                  if (!photo) return undefined;
                  return {
                    url: photo.url,
                    fallbackUrl: photo.fallbackUrl,
                    s3Key: photo.s3Key,
                  };
                }}
              />
            </div>

            <p className="mt-12 text-center text-sm">
              <Link href={`/event/${event.id}`} className="font-medium text-pine underline">
                See the photo gallery &rarr;
              </Link>
            </p>

            <GuestReferralLink source="gallery" />
          </>
        )}
        </div>
      </section>
    </Layout>
  );
}
