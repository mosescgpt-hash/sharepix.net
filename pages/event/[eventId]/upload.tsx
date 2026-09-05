import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import UploadForm from '@/components/UploadForm';
import { fetchEvent, fetchEventMoments } from '@/lib/api';
import { eventLifecycle } from '@/lib/lifecycle';
import { videosRemaining } from '@/lib/pricing';
import { themeKeyForEvent } from '@/lib/eventTheme';
import { guestBookAvailable } from '@/lib/guestBook';
import { resolveMomentId, sortMoments } from '@/lib/moments';
import { EventMoment, QREvent } from '@/lib/types';

/**
 * Where a guest lands after scanning the code. This is the page that earns the
 * money, and it is a phone page first — one column, thumb-reachable, no
 * horizontal anything.
 *
 * The entitlement logic is untouched by the redesign: whether uploads are open
 * comes from `eventLifecycle` and is re-derived on the server for every write,
 * so nothing here decides what a guest is allowed to do.
 */
export default function GuestUploadPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [moments, setMoments] = useState<EventMoment[]>([]);
  const [momentId, setMomentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    fetchEvent(eventId)
      .then((ev) => {
        if (cancelled) return;
        if (!ev) {
          setError('We couldn’t find that event. Double-check the QR code or link.');
        } else {
          setEvent(ev);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading the event. Try again in a moment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Moments load separately and never block the upload form. An event with no
  // moments is the common case, and a failure here must not stop a guest at a
  // party from adding photos.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetchEventMoments(eventId)
      .then((found) => {
        if (!cancelled) setMoments(found);
      })
      .catch(() => {
        if (!cancelled) setMoments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // `?moment=` comes from the QR code the guest scanned. Resolved against the
  // event's own list, so a card printed for a moment the host has since deleted
  // simply uploads unfiled instead of erroring. The server re-derives the same
  // answer; this is for the guest's benefit, not for security.
  useEffect(() => {
    const claimed = typeof router.query.moment === 'string' ? router.query.moment : null;
    setMomentId(resolveMomentId(claimed, moments));
  }, [router.query.moment, moments]);

  const canUpload = eventLifecycle(event).uploadOpen;
  const photosOnly =
    event != null && (event.videoUploadsEnabled === false || videosRemaining(event) === 0);

  return (
    <Layout title={event ? `Upload to ${event.name}` : 'Upload photos and videos'} width="bleed">
      {loading ? (
        <section className="spx-section-canvas">
          <p className="spx-body text-center">Loading event&hellip;</p>
        </section>
      ) : error ? (
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-lg">
            <Notice tone="error">{error}</Notice>
          </div>
        </section>
      ) : event ? (
        <>
          <section className="spx-section-ink py-10 sm:py-14">
            <div className="mx-auto w-full max-w-lg">
              <p className="spx-eyebrow">
                You&rsquo;re adding {photosOnly ? 'photos' : 'photos and videos'} to
              </p>
              <h1 className="spx-display mt-3">{event.name}</h1>
              {event.date ? (
                <p className="spx-display-serif mt-1 text-2xl">
                  {new Date(`${event.date}T00:00:00`).toLocaleDateString()}
                </p>
              ) : null}
              {event.location ? (
                <p className="mt-2 text-sm text-canvas/70">{event.location}</p>
              ) : null}
            </div>
          </section>

          <section className="spx-section-canvas py-10 sm:py-14">
            <div className="mx-auto w-full max-w-lg">
              {/* Shown only when the host actually set moments up. An event
                  with none looks exactly as it did before this existed. */}
              {moments.length > 0 && canUpload && event.paid !== false ? (
                <div className="spx-card mb-6 p-5">
                  <label
                    htmlFor="moment-picker"
                    className="block font-sans text-sm font-medium text-charcoal"
                  >
                    Which part of the day?
                  </label>
                  <select
                    id="moment-picker"
                    value={momentId ?? ''}
                    onChange={(e) => setMomentId(e.target.value || null)}
                    className="spx-input mt-2"
                  >
                    <option value="">Not sure / just add them</option>
                    {sortMoments(moments).map((moment) => (
                      <option key={moment.id} value={moment.id}>
                        {moment.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-charcoal/55">
                    Only helps the host group the gallery afterwards. Skip it if you would rather.
                  </p>
                </div>
              ) : null}

              {event.paid === false ? (
                <Notice tone="warn" label="Not open yet">
                  This event isn&rsquo;t active yet. The host needs to finish setting it up before
                  photos can be added.
                </Notice>
              ) : canUpload ? (
                <UploadForm
                  eventId={event.id}
                  allowVideo={event.videoUploadsEnabled !== false}
                  videosRemaining={videosRemaining(event)}
                  themeKey={themeKeyForEvent(event)}
                  momentId={momentId}
                />
              ) : event.uploadsClosed ? (
                <Notice tone="warn" label="Closed by the host">
                  The host has closed this event, so it&rsquo;s no longer accepting new photos. You
                  can still view the gallery below.
                </Notice>
              ) : (
                <Notice tone="warn" label="Window closed">
                  This event&rsquo;s upload window has closed.
                </Notice>
              )}

              {/* Offered after the upload form, not before it: a guest who just
                  scanned the code came to add photos, and the note reads as a
                  nice extra once they have. */}
              {guestBookAvailable(event) && canUpload ? (
                <div className="spx-card mt-10 p-6">
                  <p className="spx-eyebrow">While you&rsquo;re here</p>
                  <h2 className="spx-display-serif mt-2 text-2xl">Leave them a note.</h2>
                  <p className="spx-body mt-2 text-sm">
                    Sign the guest book — a message, and one of your photos or a video message if
                    you like.
                  </p>
                  <Link href={`/event/${event.id}/guestbook`} className="spx-btn-outline mt-5">
                    Sign the guest book
                  </Link>
                </div>
              ) : null}

              <p className="mt-8 text-center text-sm">
                <Link href={`/event/${event.id}`} className="text-pine underline">
                  View the event gallery &rarr;
                </Link>
              </p>
            </div>
          </section>
        </>
      ) : null}
    </Layout>
  );
}
