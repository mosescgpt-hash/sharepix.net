import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import PhotoGrid from '@/components/PhotoGrid';
import { fetchEvent, fetchEventPhotos, getCurrentUserInfo } from '@/lib/api';
import { isGlobalAdmin } from '@/lib/admin';
import { eventLifecycle } from '@/lib/lifecycle';
import { canDownloadEventMedia, galleryVariantFor, isEventHost } from '@/lib/gallery';
import { DisplayPhoto, QREvent } from '@/lib/types';

export default function EventGalleryPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState(false);
  const [admin, setAdmin] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const ev = await fetchEvent(eventId);
      if (!ev) {
        setError('We couldn\u2019t find that event.');
        return;
      }
      setEvent(ev);
      const [user, isAdmin] = await Promise.all([
        getCurrentUserInfo(),
        isGlobalAdmin().catch(() => false),
      ]);
      const isHost = isEventHost(ev, user);
      setHost(isHost);
      setAdmin(isAdmin);
      // Fetch photos when someone is allowed to see them: the host/admin always,
      // guests only while the gallery is still showing something. Guests in the
      // post-window low-res phase get the small thumbnails.
      const lc = eventLifecycle(ev);
      const privilegedViewer = isHost || isAdmin;
      if (privilegedViewer || lc.guestResolution !== 'none') {
        const items = await fetchEventPhotos(eventId, {
          // Small variant either because the window has closed, or because the
          // host has withheld downloads for this event.
          useThumbs:
            !privilegedViewer &&
            (lc.guestResolution === 'small' || galleryVariantFor(ev, privilegedViewer) === 'thumb'),
        });
        setPhotos(items);
      }
    } catch {
      setError('Something went wrong loading the gallery. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const privileged = host || admin;
  const lifecycle = eventLifecycle(event);
  // The host/admin can always see the gallery; guests can while it's not closed.
  const canSee = privileged || lifecycle.guestResolution !== 'none';
  const lowResOnly = !privileged && lifecycle.guestResolution === 'small';
  const canDownload = event ? canDownloadEventMedia(event, privileged) : false;

  return (
    <Layout title={event ? event.name : 'Event gallery'}>
      <section className="py-8">
        {loading ? (
          <p className="text-center text-muted">Loading gallery…</p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">
            {error}
          </p>
        ) : event ? (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="font-display text-3xl font-bold sm:text-4xl">{event.name}</h1>
              {event.location ? <p className="text-muted">{event.location}</p> : null}
              <p className="text-muted">
                {photos.length} item{photos.length === 1 ? '' : 's'} shared by guests
              </p>
              <div className="mt-2 flex gap-3 text-sm">
                {lifecycle.uploadOpen ? (
                  <Link
                    href={`/event/${event.id}/upload`}
                    className="rounded-full bg-ink px-5 py-2 font-medium text-white hover:bg-night"
                  >
                    Add your photos
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={load}
                  className="rounded-full border border-ink/20 px-5 py-2 font-medium hover:border-accent hover:text-accent"
                >
                  Refresh
                </button>
              </div>
            </div>

            {router.query.prints === 'success' ? (
              <p className="mx-auto mt-6 max-w-lg rounded-xl bg-mint/40 px-4 py-3 text-center text-sm text-ink">
                Thanks! Your print order is confirmed — we’re sending it to print and it’ll
                ship to the address you provided.
              </p>
            ) : router.query.prints === 'cancelled' ? (
              <p className="mx-auto mt-6 max-w-lg rounded-xl bg-smoke px-4 py-3 text-center text-sm text-muted">
                Print order cancelled — nothing was charged.
              </p>
            ) : null}

            {lowResOnly ? (
              <p className="mx-auto mt-6 max-w-lg rounded-xl bg-smoke px-4 py-3 text-center text-sm text-muted">
                Uploads for this event have closed. These previews stay available for a
                little longer before the gallery closes.
              </p>
            ) : !privileged && event.guestDownloadsBlocked === true ? (
              <p className="mx-auto mt-6 max-w-lg rounded-xl bg-smoke px-4 py-3 text-center text-sm text-muted">
                The host has kept downloads for this event to themselves, so these are
                viewing copies. Ask them if you would like a full-size photo.
              </p>
            ) : null}

            <div className="mt-8">
              {canSee ? (
                <PhotoGrid
                  photos={photos}
                  canDownload={canDownload}
                  canViewOriginal={host || admin}
                  eventName={event.name}
                  eventId={event.id}
                />
              ) : (
                <p className="mx-auto max-w-lg rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
                  This gallery has closed. Hosts can still reach it from the admin dashboard.
                </p>
              )}
            </div>
          </>
        ) : null}
      </section>
    </Layout>
  );
}
