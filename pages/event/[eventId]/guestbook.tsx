import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import GuestBookAlbum from '@/components/GuestBookAlbum';
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
    <Layout title={event ? `${event.name} guest book` : 'Guest book'}>
      <section className="mx-auto max-w-2xl py-10">
        {loading ? (
          <p className="text-center text-muted">Loading the guest book…</p>
        ) : error ? (
          <p className="rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">{error}</p>
        ) : !event ? null : !available ? (
          <div className="sp-card p-8 text-center">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              This event doesn&apos;t have a guest book
            </h1>
            <p className="mt-3 text-muted">
              The host can add one from their dashboard. In the meantime you can still
              add your photos.
            </p>
            <Link href={`/event/${event.id}/upload`} className="sp-btn-primary mt-6">
              Add your photos
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center">
              <p className="sp-eyebrow">Guest book</p>
              <h1 className="mt-4 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
                {event.name}
              </h1>
              <p className="mx-auto mt-4 max-w-md text-muted">
                Leave a note for the host — and add one of your photos or a video
                message if you like.
              </p>
            </div>

            {/* The form sits above the album: a guest arriving from the QR code
                came to sign it, not to read it. */}
            <form onSubmit={handleSubmit} className="sp-card mt-10 p-6 sm:p-8">
              {done ? (
                <div
                  className={`mb-6 rounded-xl px-4 py-3 text-sm ${
                    done === 'pending'
                      ? 'bg-amber-50 text-amber-900'
                      : 'bg-accent/10 text-accent'
                  }`}
                  role="status"
                >
                  {done === 'pending'
                    ? 'Thank you — your note is with the host and will appear once they approve it.'
                    : 'Thank you — your note is in the book below.'}
                </div>
              ) : null}

              <label htmlFor="gb-name" className="block text-sm font-medium">
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
                className="mt-2 w-full rounded-xl border border-line bg-card px-4 py-3 focus:border-accent focus:outline-none"
              />

              <label htmlFor="gb-message" className="mt-5 block text-sm font-medium">
                Your note
              </label>
              <textarea
                id="gb-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={MAX_MESSAGE_LENGTH}
                rows={5}
                placeholder="What a day. So happy for you both."
                className="mt-2 w-full rounded-xl border border-line bg-card px-4 py-3 focus:border-accent focus:outline-none"
              />
              <p className="mt-1 text-right text-xs text-muted">
                {message.length} / {MAX_MESSAGE_LENGTH}
              </p>

              {attachable.length > 0 ? (
                <>
                  <label htmlFor="gb-photo" className="mt-4 block text-sm font-medium">
                    Attach one of your photos or videos <span className="text-muted">(optional)</span>
                  </label>
                  <select
                    id="gb-photo"
                    value={photoId}
                    onChange={(e) => setPhotoId(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-line bg-card px-4 py-3 focus:border-accent focus:outline-none"
                  >
                    <option value="">No attachment</option>
                    {attachable.map((photo, i) => (
                      <option key={photo.id} value={photo.id}>
                        {isVideoFilename(photo.s3Key) ? 'Video' : 'Photo'} {i + 1}
                        {photo.uploadedBy ? ` — ${photo.uploadedBy}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-muted">
                    Haven&apos;t uploaded yet?{' '}
                    <Link href={`/event/${event.id}/upload`} className="text-accent underline">
                      Add your photos first
                    </Link>
                    , then come back and attach one.
                  </p>
                </>
              ) : (
                <p className="mt-4 text-xs text-muted">
                  <Link href={`/event/${event.id}/upload`} className="text-accent underline">
                    Add a photo or a video message
                  </Link>{' '}
                  to attach one to your note.
                </p>
              )}

              {formError ? (
                <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={saving}
                className="sp-btn-primary mt-6 w-full disabled:opacity-60"
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
              <Link href={`/event/${event.id}`} className="font-medium text-accent">
                See the photo gallery →
              </Link>
            </p>
          </>
        )}
      </section>
    </Layout>
  );
}
