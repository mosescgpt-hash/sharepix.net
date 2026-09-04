import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import PhotoGrid from '@/components/PhotoGrid';
import { fetchEvent, fetchEventPhotos, getCurrentUserInfo } from '@/lib/api';
import { isGlobalAdmin } from '@/lib/admin';
import { eventLifecycle } from '@/lib/lifecycle';
import { canDownloadEventMedia, galleryVariantFor, isEventHost } from '@/lib/gallery';
import { DisplayPhoto, QREvent } from '@/lib/types';
import { guestBookAvailable } from '@/lib/guestBook';

/**
 * The guest gallery, on the redesign system. Mobile first — most people reach
 * this by scanning a code at a table, on a phone, in bad light.
 *
 * The loading behaviour, entitlement checks and lifecycle rules below are
 * unchanged from before the redesign. What a guest may see is decided by
 * `eventLifecycle` and the server, never by this layout.
 */
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
        setError('We couldn’t find that event.');
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
    <Layout title={event ? event.name : 'Event gallery'} width="bleed">
      {loading ? (
        <section className="spx-section-canvas">
          <div className="spx-inner">
            <p className="spx-body text-center">Loading gallery&hellip;</p>
          </div>
        </section>
      ) : error ? (
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-lg">
            <Notice tone="error">{error}</Notice>
          </div>
        </section>
      ) : event ? (
        <>
          {/* The event's own name is the headline. The navy band gives the
              gallery a masthead instead of opening on a bare grid. */}
          <section className="spx-section-ink py-12 sm:py-16">
            <div className="spx-inner">
              <p className="spx-eyebrow">
                {photos.length} {photos.length === 1 ? 'memory' : 'memories'} shared
              </p>
              <h1 className="spx-display mt-3">{event.name}</h1>
              {event.location ? (
                <p className="spx-display-serif mt-1 text-2xl sm:text-3xl">{event.location}</p>
              ) : null}

              <div className="mt-8 flex flex-wrap gap-3">
                {lifecycle.uploadOpen ? (
                  <Link href={`/event/${event.id}/upload`} className="spx-btn-canvas">
                    Add your photos
                  </Link>
                ) : null}
                {guestBookAvailable(event) ? (
                  <Link href={`/event/${event.id}/guestbook`} className="spx-btn-outline">
                    Guest book
                  </Link>
                ) : null}
                <button type="button" onClick={load} className="spx-btn-outline">
                  Refresh
                </button>
              </div>
            </div>
          </section>

          <section className="spx-section-canvas py-10 sm:py-14">
            <div className="spx-inner">
              <div className="space-y-4">
                {router.query.prints === 'success' ? (
                  <Notice tone="success">
                    Your print order is confirmed — we&rsquo;re sending it to print and it&rsquo;ll
                    ship to the address you provided.
                  </Notice>
                ) : router.query.prints === 'cancelled' ? (
                  <Notice label="">Print order cancelled — nothing was charged.</Notice>
                ) : null}

                {lowResOnly ? (
                  <Notice label="">
                    Uploads for this event have closed. These previews stay available for a little
                    longer before the gallery closes.
                  </Notice>
                ) : !privileged && event.guestDownloadsBlocked === true ? (
                  <Notice label="">
                    The host has kept downloads for this event to themselves, so these are viewing
                    copies. Ask them if you would like a full-size photo.
                  </Notice>
                ) : null}
              </div>

              <div className="mt-8">
                {!canSee ? (
                  <Notice tone="warn" label="Gallery closed">
                    This gallery has closed. Hosts can still reach it from the admin dashboard.
                  </Notice>
                ) : photos.length === 0 ? (
                  <div className="spx-empty">
                    <p className="spx-display-serif text-2xl">Nothing here yet.</p>
                    <p className="spx-body mt-2 max-w-sm text-sm">
                      Be the first to add something — every photo your guests take lands here.
                    </p>
                    {lifecycle.uploadOpen ? (
                      <Link href={`/event/${event.id}/upload`} className="spx-btn-ink mt-6">
                        Add your photos
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <PhotoGrid
                    photos={photos}
                    canDownload={canDownload}
                    canViewOriginal={host || admin}
                    eventName={event.name}
                    eventId={event.id}
                  />
                )}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </Layout>
  );
}
