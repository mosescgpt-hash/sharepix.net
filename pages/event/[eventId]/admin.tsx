import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import AdminPhotoGrid from '@/components/AdminPhotoGrid';
import EventQRCode from '@/components/EventQRCode';
import DownloadShareBuilder from '@/components/DownloadShareBuilder';
import { fetchEvent, fetchEventPhotos, getCurrentUserInfo } from '@/lib/api';
import { getTier } from '@/lib/pricing';
import { DisplayPhoto, QREvent } from '@/lib/types';
import { isGlobalAdmin } from '@/lib/admin';

function AdminDashboardPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const [ev, user, globalAdmin] = await Promise.all([
        fetchEvent(eventId),
        getCurrentUserInfo(),
        isGlobalAdmin(),
      ]);
      if (!ev) {
        setError('We couldn\u2019t find that event.');
        return;
      }
      // Owner-only access: the data auth rules protect mutations server-side;
      // this check keeps non-owners out of the dashboard UI too.
      // (Gen 2 owner fields are "<sub>::<username>", so match on the user id.)
      const isOwner = !!user && !!ev.owner && ev.owner.includes(user.userId);
      if (!isOwner && !globalAdmin) {
        setDenied(true);
        return;
      }
      setEvent(ev);
      const items = await fetchEventPhotos(eventId, { includeUnapproved: true, useOriginals: true });
      setPhotos(items);
    } catch {
      setError('Something went wrong loading the dashboard. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const tier = event ? getTier(event.tier) : undefined;
  const hiddenCount = photos.filter((p) => p.approved === false).length;

  return (
    <Layout title={event ? `Admin — ${event.name}` : 'Admin dashboard'}>
      <section className="py-8">
        {loading ? (
          <p className="text-center text-ink/60">Loading dashboard…</p>
        ) : denied ? (
          <p className="mx-auto max-w-lg rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
            Only the event host or a sharepix.net global administrator can open this dashboard.
          </p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">
            {error}
          </p>
        ) : event ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-wide text-ink/50">Admin dashboard</p>
                <h1 className="font-display text-3xl font-extrabold">{event.name}</h1>
                <p className="mt-1 text-sm text-ink/60">
                  {tier?.name ?? event.tier} plan · Event code {event.eventCode}
                  {event.accessExpiresAt
                    ? ` · Access until ${new Date(event.accessExpiresAt).toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setShowQR((v) => !v)}
                  className="rounded-full border border-ink/20 px-4 py-2 font-medium hover:border-accent hover:text-accent"
                >
                  {showQR ? 'Hide QR code' : 'Show QR code'}
                </button>
                <Link
                  href={`/event/${event.id}`}
                  className="rounded-full border border-ink/20 px-4 py-2 font-medium hover:border-accent hover:text-accent"
                >
                  Public gallery
                </Link>
                <button
                  type="button"
                  onClick={load}
                  className="rounded-full bg-ink px-4 py-2 font-medium text-white hover:bg-night"
                >
                  Refresh
                </button>
              </div>
            </div>

            {showQR ? (
              <div className="mx-auto mt-6 max-w-sm">
                <EventQRCode
                  eventId={event.id}
                  eventName={event.name}
                  allowCustomization={tier?.id !== 'starter'}
                />
              </div>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-3 sm:max-w-md">
              <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
                <p className="font-display text-2xl font-bold">{photos.length}</p>
                <p className="text-xs text-ink/60">Total photos</p>
              </div>
              <div className="rounded-xl border border-ink/10 bg-white p-4 text-center">
                <p className="font-display text-2xl font-bold">{hiddenCount}</p>
                <p className="text-xs text-ink/60">Hidden from gallery</p>
              </div>
            </div>

            <div className="mt-8">
              {tier?.id === 'premium' ? (
                <DownloadShareBuilder event={event} photos={photos} />
              ) : (
                <div className="rounded-xl border border-dashed border-ink/20 bg-white px-4 py-5 text-sm text-ink/60">
                  Download-sharing QR codes with a host-selected collection are available on Premium events.
                </div>
              )}
            </div>

            <div className="mt-8">
              <AdminPhotoGrid photos={photos} onChanged={load} />
            </div>
          </>
        ) : null}
      </section>
    </Layout>
  );
}

// Cognito sign-in is required to reach this page at all;
// the owner check above then limits it to the event's host.
export default withAuthenticator(AdminDashboardPage);
