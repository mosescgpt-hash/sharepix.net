import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import PhotoGrid from '@/components/PhotoGrid';
import { fetchEvent, fetchEventPhotos, getCurrentUserInfo } from '@/lib/api';
import { isGalleryActive } from '@/lib/validation';
import { canDownloadEventMedia, isEventHost } from '@/lib/gallery';
import { DisplayPhoto, QREvent } from '@/lib/types';

export default function EventGalleryPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState(false);

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
      const user = await getCurrentUserInfo();
      setHost(isEventHost(ev, user));
      if (isGalleryActive(ev.accessExpiresAt)) {
        const items = await fetchEventPhotos(eventId);
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

  const active = isGalleryActive(event?.accessExpiresAt);
  const canDownload = event ? canDownloadEventMedia(event.tier, host) : false;

  return (
    <Layout title={event ? event.name : 'Event gallery'}>
      <section className="py-8">
        {loading ? (
          <p className="text-center text-ink/60">Loading gallery…</p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">
            {error}
          </p>
        ) : event ? (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="font-display text-3xl font-extrabold sm:text-4xl">{event.name}</h1>
              <p className="text-ink/60">
                {photos.length} item{photos.length === 1 ? '' : 's'} shared by guests
              </p>
              <div className="mt-2 flex gap-3 text-sm">
                <Link
                  href={`/event/${event.id}/upload`}
                  className="rounded-full bg-ink px-5 py-2 font-medium text-white hover:bg-night"
                >
                  Add your photos
                </Link>
                <button
                  type="button"
                  onClick={load}
                  className="rounded-full border border-ink/20 px-5 py-2 font-medium hover:border-accent hover:text-accent"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="mt-8">
              {active ? (
                <PhotoGrid
                  photos={photos}
                  canDownload={canDownload}
                  eventName={event.name}
                  downloadMessage="Guest downloads are included with Premium. Event hosts can sign in to download on any plan."
                />
              ) : (
                <p className="mx-auto max-w-lg rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
                  This gallery&apos;s access window has ended. Hosts can still reach it
                  from the admin dashboard.
                </p>
              )}
            </div>
          </>
        ) : null}
      </section>
    </Layout>
  );
}
