import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import AdminPhotoGrid from '@/components/AdminPhotoGrid';
import EventQRCode from '@/components/EventQRCode';
import DownloadShareBuilder from '@/components/DownloadShareBuilder';
import {
  fetchEvent,
  fetchEventPhotos,
  getCurrentUserInfo,
  getMyCorporateSubscription,
  isCorporateActive,
  setEventUploadsClosed,
  startGuestDownloadAddOn,
  updateEventDetails,
} from '@/lib/api';
import { CORPORATE_PLAN, getTier } from '@/lib/pricing';
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
  const [showQR, setShowQR] = useState(true);

  // Event-settings panel state (edit name/date, close/reopen uploads).
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [closing, setClosing] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [corporateActive, setCorporateActive] = useState(false);
  const [addOnWorking, setAddOnWorking] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const [ev, user, globalAdmin, corporateSub] = await Promise.all([
        fetchEvent(eventId),
        getCurrentUserInfo(),
        isGlobalAdmin(),
        getMyCorporateSubscription().catch(() => null),
      ]);
      setCorporateActive(isCorporateActive(corporateSub));
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

  useEffect(() => {
    if (!event || !router.asPath.endsWith('#event-qr-code')) return;
    const timer = window.setTimeout(() => {
      document.getElementById('event-qr-code')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [event, router.asPath]);

  // Keep the edit fields in sync with the loaded event.
  useEffect(() => {
    if (!event) return;
    setEditName(event.name ?? '');
    setEditDate(event.date ?? '');
  }, [event]);

  const tier = event ? getTier(event.tier) : undefined;
  const hiddenCount = photos.filter((p) => p.approved === false).length;
  // Name/date can be edited only until the first photo lands. Prefer the
  // server-maintained counter, falling back to what we loaded.
  const photoCount = event?.photoCount ?? photos.length;
  const detailsLocked = photoCount > 0;

  async function handleSaveDetails() {
    if (!event) return;
    setSavingDetails(true);
    setSettingsMsg(null);
    try {
      const updated = await updateEventDetails(event.id, { name: editName, date: editDate });
      setEvent(updated);
      setSettingsMsg({ text: 'Event details updated.', ok: true });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The event could not be updated.',
        ok: false,
      });
    } finally {
      setSavingDetails(false);
    }
  }

  async function handleToggleClosed() {
    if (!event) return;
    const next = !event.uploadsClosed;
    setClosing(true);
    setSettingsMsg(null);
    try {
      await setEventUploadsClosed(event.id, next);
      setEvent({ ...event, uploadsClosed: next });
      setSettingsMsg({
        text: next
          ? 'Event closed — guests can no longer upload.'
          : 'Event reopened — guests can upload again.',
        ok: true,
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The event could not be updated.',
        ok: false,
      });
    } finally {
      setClosing(false);
    }
  }

  async function handleEnableGuestDownloads() {
    if (!event) return;
    setAddOnWorking(true);
    setSettingsMsg(null);
    try {
      const url = await startGuestDownloadAddOn(event.id);
      window.location.assign(url);
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'Checkout could not be started.',
        ok: false,
      });
      setAddOnWorking(false);
    }
  }

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
              <div id="event-qr-code" className="mx-auto mt-6 max-w-sm scroll-mt-24">
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

            <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl font-bold">Event settings</h2>
                <Link
                  href={`/event/${event.id}/brochure`}
                  target="_blank"
                  className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
                >
                  Printable brochure →
                </Link>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium">Event name</span>
                  <input
                    type="text"
                    value={editName}
                    disabled={detailsLocked || savingDetails}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-ink/20 px-3 py-2.5 focus:border-accent focus:outline-none disabled:bg-smoke disabled:text-ink/50"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Event date</span>
                  <input
                    type="date"
                    value={editDate}
                    disabled={detailsLocked || savingDetails}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-ink/20 px-3 py-2.5 focus:border-accent focus:outline-none disabled:bg-smoke disabled:text-ink/50"
                  />
                </label>
              </div>

              {detailsLocked ? (
                <p className="mt-2 text-xs text-ink/55">
                  The name and date lock once the first photo is uploaded, so guests&apos;
                  memories keep the details they saw.
                </p>
              ) : (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={handleSaveDetails}
                    disabled={savingDetails}
                    className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-night disabled:opacity-50"
                  >
                    {savingDetails ? 'Saving…' : 'Save details'}
                  </button>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-5">
                <div>
                  <p className="text-sm font-medium">
                    Uploads are {event.uploadsClosed ? 'closed' : 'open'}
                  </p>
                  <p className="text-xs text-ink/55">
                    {event.uploadsClosed
                      ? 'Guests cannot add new photos. The gallery stays viewable.'
                      : 'Close the event when you have all the photos you want.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleClosed}
                  disabled={closing}
                  className={`rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50 ${
                    event.uploadsClosed
                      ? 'bg-accent text-white hover:bg-accent/90'
                      : 'border border-red-500 text-red-700 hover:bg-red-50'
                  }`}
                >
                  {closing
                    ? 'Working…'
                    : event.uploadsClosed
                      ? 'Reopen uploads'
                      : 'Close event'}
                </button>
              </div>

              <div className="mt-5 border-t border-ink/10 pt-5">
                <p className="text-sm font-medium">Guest downloads</p>
                {event.guestDownloadEnabled ? (
                  <p className="mt-1 text-sm text-green-700">
                    ✓ Enabled — guests can download photos and videos from this event.
                  </p>
                ) : corporateActive ? (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-ink/60">
                      Off by default. Turn on guest downloads for this one event as a
                      one-time add-on.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleEnableGuestDownloads()}
                      disabled={addOnWorking}
                      className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                    >
                      {addOnWorking
                        ? 'Opening…'
                        : `Enable guest downloads · $${CORPORATE_PLAN.guestDownloadAddOnPrice}`}
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-ink/60">
                    Guest downloads are available as a per-event add-on on the{' '}
                    <Link href="/corporate" className="text-accent underline">
                      Corporate plan
                    </Link>
                    . Hosts can always download their own events.
                  </p>
                )}
              </div>

              {settingsMsg ? (
                <p
                  className={`mt-3 text-sm ${settingsMsg.ok ? 'text-green-700' : 'text-red-700'}`}
                >
                  {settingsMsg.text}
                </p>
              ) : null}
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
