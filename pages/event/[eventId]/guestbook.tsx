import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import GuestBookAlbum from '@/components/GuestBookAlbum';
import Notice from '@/components/Notice';
import { isVideoFilename } from '@/lib/validation';
import { fetchEvent, fetchEventPhotos, fetchGuestBook, signGuestBook } from '@/lib/api';
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
    const [book, media] = await Promise.all([
      fetchGuestBook(eventId),
      fetchEventPhotos(eventId).catch(() => [] as DisplayPhoto[]),
    ]);
    setEntries(book);
    setPhotos(media);
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

  async function handleSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    if (!eventId || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const result = await signGuestBook({
        eventId,
        name,
        message,
        photoId: photoId || null,
      });
      setDone(result.pending ? 'pending' : 'shown');
      setName('');
      setMessage('');
      setPhotoId('');
      // A held note is not in the album yet, so only reload when it will show.
      if (!result.pending) await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'We could not save that note.');
    } finally {
      setSaving(false);
    }
  }

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
                    {done === 'pending'
                      ? 'Thank you — your note is with the host and will appear once they approve it.'
                      : 'Thank you — your note is in the book below.'}
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
              <p className="mt-1 text-right text-xs text-charcoal/55">
                {message.length} / {MAX_MESSAGE_LENGTH}
              </p>

              {attachable.length > 0 ? (
                <>
                  <label htmlFor="gb-photo" className="mt-4 block font-sans text-sm font-medium text-charcoal">
                    Attach one of your photos or videos <span className="text-charcoal/55">(optional)</span>
                  </label>
                  <select
                    id="gb-photo"
                    value={photoId}
                    onChange={(e) => setPhotoId(e.target.value)}
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
                  <p className="mt-2 text-xs text-charcoal/55">
                    Haven&apos;t uploaded yet?{' '}
                    <Link href={`/event/${event.id}/upload`} className="text-pine underline">
                      Add your photos first
                    </Link>
                    , then come back and attach one.
                  </p>
                </>
              ) : (
                <p className="mt-4 text-xs text-charcoal/55">
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
                {saving ? 'Signing…' : 'Sign the guest book'}
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
          </>
        )}
        </div>
      </section>
    </Layout>
  );
}
