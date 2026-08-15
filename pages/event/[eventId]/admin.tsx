import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import AdminPhotoGrid from '@/components/AdminPhotoGrid';
import EventQRCode from '@/components/EventQRCode';
import DownloadShareBuilder from '@/components/DownloadShareBuilder';
import {
  deleteEventWithPhotos,
  fetchEvent,
  fetchEventPhotos,
  getCurrentUserInfo,
  getMyCorporateSubscription,
  isCorporateActive,
  setEventAlertEmail,
  setEventModerationMode,
  setEventUploadsClosed,
  setEventVideoUploads,
  startAddOnCheckout,
  type EventAddOnKey,
  updateEventDetails,
} from '@/lib/api';
import {
  CORPORATE_PLAN,
  LIVE_SLIDESHOW_ADDON_PRICE,
  extensionPrice,
  getTier,
  videosRemaining,
} from '@/lib/pricing';
import { eventLifecycle } from '@/lib/lifecycle';
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
  // One cart for the paid add-ons: tick what you want, pay once.
  const [selectedAddOns, setSelectedAddOns] = useState<Set<EventAddOnKey>>(new Set());
  const [checkoutWorking, setCheckoutWorking] = useState(false);
  const [moderationWorking, setModerationWorking] = useState(false);
  const [alertEmail, setAlertEmail] = useState('');
  const [alertWorking, setAlertWorking] = useState(false);
  const [videoWorking, setVideoWorking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Optional discount code applied to the extension / guest-download add-on.
  const [discountCode, setDiscountCode] = useState('');

  // Download-QR share selection, built by toggling photos in the gallery below.
  const [shareSelected, setShareSelected] = useState<Set<string>>(new Set());
  const approvedPhotoIds = useMemo(
    () => photos.filter((photo) => photo.approved !== false).map((photo) => photo.id),
    [photos],
  );
  const guestDownloadsOn = event?.guestDownloadEnabled === true;
  // Default the selection to the whole (approved) event whenever the photo set
  // changes, matching the old builder's behavior.
  useEffect(() => {
    if (!guestDownloadsOn) return;
    setShareSelected(new Set(approvedPhotoIds));
  }, [guestDownloadsOn, approvedPhotoIds]);
  const toggleShare = useCallback((id: string) => {
    setShareSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectedApprovedIds = approvedPhotoIds.filter((id) => shareSelected.has(id));

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
    setAlertEmail(event.alertEmail ?? '');
  }, [event]);

  const tier = event ? getTier(event.tier) : undefined;
  const hiddenCount = photos.filter((p) => p.approved === false).length;
  // Name/date can be edited only until the first photo lands. Prefer the
  // server-maintained counter, falling back to what we loaded.
  const photoCount = event?.photoCount ?? photos.length;
  const detailsLocked = photoCount > 0;
  // The guest-download add-on is offered on Premium events and to Corporate
  // subscribers only.
  const addOnEligible = tier?.id === 'premium' || corporateActive;
  // What this event can still buy. Extensions only apply to the fixed-length
  // plans (a corporate event has no plan price to halve), and each add-on drops
  // off the list once it's active.
  const availableAddOns = useMemo(() => {
    if (!event) return [];
    const items: { key: EventAddOnKey; label: string; price: number; description: string }[] = [];
    if (getTier(event.tier)) {
      items.push({
        key: 'extend',
        label: 'Extend upload window (+30 days)',
        price: extensionPrice(event.tier),
        description: 'Give guests another 30 days to add photos.',
      });
    }
    if (!event.guestDownloadEnabled && addOnEligible) {
      items.push({
        key: 'guest_download',
        label: 'Guest downloads',
        price: CORPORATE_PLAN.guestDownloadAddOnPrice,
        description: 'Let guests download photos and videos, and share a download QR code.',
      });
    }
    if (!event.liveSlideshowEnabled) {
      items.push({
        key: 'live_slideshow',
        label: 'Live slideshow',
        price: LIVE_SLIDESHOW_ADDON_PRICE,
        description: 'Show photos on a screen at your venue as guests upload them.',
      });
    }
    return items;
  }, [event, addOnEligible]);

  const addOnTotal = availableAddOns
    .filter((addon) => selectedAddOns.has(addon.key))
    .reduce((sum, addon) => sum + addon.price, 0);

  const lifecycle = eventLifecycle(event);

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

  async function handleVideoUploads(enabled: boolean) {
    if (!event) return;
    setVideoWorking(true);
    setSettingsMsg(null);
    try {
      await setEventVideoUploads(event.id, enabled);
      setEvent({ ...event, videoUploadsEnabled: enabled });
      setSettingsMsg({
        text: enabled
          ? 'Guests can upload videos again.'
          : 'Videos are off — guests can add photos only. Videos already uploaded stay in the gallery.',
        ok: true,
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The setting could not be updated.',
        ok: false,
      });
    } finally {
      setVideoWorking(false);
    }
  }

  async function handleSaveAlertEmail() {
    if (!event) return;
    setAlertWorking(true);
    setSettingsMsg(null);
    try {
      await setEventAlertEmail(event.id, alertEmail);
      setEvent({ ...event, alertEmail: alertEmail.trim() || null });
      setSettingsMsg({
        text: alertEmail.trim()
          ? `Alerts will go to ${alertEmail.trim()}.`
          : 'Alert emails turned off. Held photos are still in your dashboard.',
        ok: true,
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The alert email could not be saved.',
        ok: false,
      });
    } finally {
      setAlertWorking(false);
    }
  }

  async function handleModerationMode(mode: 'review' | 'allow_all') {
    if (!event || (event.moderationMode ?? 'review') === mode) return;
    setModerationWorking(true);
    setSettingsMsg(null);
    try {
      await setEventModerationMode(event.id, mode);
      setEvent({ ...event, moderationMode: mode });
      setSettingsMsg({
        text:
          mode === 'allow_all'
            ? 'Screening off — new photos appear right away. Photos already held stay hidden until you release them.'
            : 'Screening on — potentially explicit photos will be held for your review.',
        ok: true,
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The setting could not be updated.',
        ok: false,
      });
    } finally {
      setModerationWorking(false);
    }
  }

  function toggleAddOn(key: EventAddOnKey) {
    setSelectedAddOns((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleAddOnCheckout() {
    if (!event || selectedAddOns.size === 0) return;
    setCheckoutWorking(true);
    setSettingsMsg(null);
    try {
      const url = await startAddOnCheckout(event.id, [...selectedAddOns], discountCode);
      window.location.assign(url);
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'Checkout could not be started.',
        ok: false,
      });
      setCheckoutWorking(false);
    }
  }

  async function handleDeleteEvent() {
    if (!event) return;
    const count = photoCount;
    const warning =
      count > 0
        ? `Delete "${event.name}" and permanently remove its ${count} photo${count === 1 ? '' : 's'}? This can't be undone.`
        : `Delete "${event.name}"? This can't be undone.`;
    if (!window.confirm(warning)) return;
    setDeleting(true);
    setSettingsMsg(null);
    try {
      await deleteEventWithPhotos(event.id);
      await router.push('/my-events');
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The event could not be deleted.',
        ok: false,
      });
      setDeleting(false);
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
                  {event.tier === 'corporate' ? 'Corporate' : tier?.name ?? event.tier} plan ·
                  Event code {event.eventCode}
                  {lifecycle.uploadWindowEndsAt
                    ? ` · Uploads ${lifecycle.uploadOpen ? 'open until' : 'closed'} ${lifecycle.uploadWindowEndsAt.toLocaleDateString()}`
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
                {/* Opens in its own tab so the venue screen can run the
                    slideshow while the host keeps managing the event here. */}
                {event.liveSlideshowEnabled ? (
                  <Link
                    href={`/event/${event.id}/live`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-accent px-4 py-2 font-medium text-accent hover:bg-accent/5"
                  >
                    Live slideshow ↗
                  </Link>
                ) : null}
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

              {/* Free settings first, then everything purchasable in one place at
                  the bottom — the discount field used to sit between them. */}
              <div className="mt-5 border-t border-ink/10 pt-5">
                <p className="text-sm font-medium">Photo screening</p>
                <p className="text-xs text-ink/55">
                  Uploads are checked for explicit content. Alcohol, smoking, and kissing are
                  never flagged.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {([
                    ['review', 'Hold flagged photos for review'],
                    ['allow_all', 'Show all photos immediately'],
                  ] as const).map(([value, label]) => {
                    const active = (event.moderationMode ?? 'review') === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={moderationWorking}
                        onClick={() => void handleModerationMode(value)}
                        className={`rounded-full border px-3 py-1.5 text-sm disabled:opacity-50 ${
                          active
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-ink/20 hover:border-accent hover:text-accent'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-ink/55">
                  {(event.moderationMode ?? 'review') === 'allow_all'
                    ? 'Nothing is screened or held back. Any photo a guest uploads appears right away — including on the slideshow.'
                    : 'A flagged photo is hidden from guests and the slideshow until you release it. Only you can see it.'}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Guest videos</p>
                    <p className="text-xs text-ink/55">
                      {event.videoUploadsEnabled === false
                        ? 'Off — guests can add photos only.'
                        : 'On. Screening checks photos but not videos, so turn this off if you want screened media only.'}
                    </p>
                    {event.videoUploadsEnabled !== false && event.videoLimit != null ? (
                      <p className="mt-1 text-sm text-ink/60">
                        {event.videoCount ?? 0} of{' '}
                        {event.videoLimit + (event.extraVideoCredits ?? 0)} videos used.
                        {videosRemaining(event) === 0
                          ? ' Guests can still add photos; deleting a video frees a slot.'
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={videoWorking}
                    onClick={() => void handleVideoUploads(event.videoUploadsEnabled === false)}
                    className="shrink-0 rounded-full border border-ink/20 px-5 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {videoWorking
                      ? 'Saving…'
                      : event.videoUploadsEnabled === false
                        ? 'Allow videos'
                        : 'Photos only'}
                  </button>
                </div>

                {(event.moderationMode ?? 'review') === 'review' ? (
                  <div className="mt-3">
                    <label htmlFor="alert-email" className="text-sm font-medium">
                      Email me when a photo is held{' '}
                      <span className="text-ink/50">(optional)</span>
                    </label>
                    <p className="text-xs text-ink/55">
                      You&apos;ll get the photo and Approve / Deny buttons, so you don&apos;t have
                      to watch your phone.
                    </p>
                    <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                      <input
                        id="alert-email"
                        type="email"
                        value={alertEmail}
                        onChange={(e) => setAlertEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="min-w-0 flex-1 rounded-xl border border-ink/20 px-4 py-2.5 focus:border-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={alertWorking}
                        onClick={() => void handleSaveAlertEmail()}
                        className="shrink-0 rounded-full border border-ink/20 px-5 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                      >
                        {alertWorking ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 border-t border-ink/10 pt-5">
                <p className="text-sm font-medium">Add-ons</p>
                <p className="text-xs text-ink/55">
                  Tick what you want and pay once.{' '}
                  {lifecycle.uploadWindowEndsAt
                    ? lifecycle.uploadOpen
                      ? `Guests can upload until ${lifecycle.uploadWindowEndsAt.toLocaleDateString()}.`
                      : `The upload window closed on ${lifecycle.uploadWindowEndsAt.toLocaleDateString()}.`
                    : ''}
                </p>

                {/* Already paid for — shown so the list reads as complete. */}
                {event.guestDownloadEnabled ? (
                  <p className="mt-3 text-sm text-green-700">
                    ✓ Guest downloads — guests can download photos and videos.
                  </p>
                ) : null}
                {event.liveSlideshowEnabled ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-green-700">
                      ✓ Live slideshow — ready for the screen at your venue.
                    </p>
                    <Link
                      href={`/event/${event.id}/live`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-full border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent/5"
                    >
                      Open slideshow ↗
                    </Link>
                  </div>
                ) : null}

                {availableAddOns.length > 0 ? (
                  <>
                    <div className="mt-3 space-y-2">
                      {availableAddOns.map((addon) => (
                        <label
                          key={addon.key}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                            selectedAddOns.has(addon.key)
                              ? 'border-accent bg-accent/5'
                              : 'border-ink/15'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAddOns.has(addon.key)}
                            onChange={() => toggleAddOn(addon.key)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="text-sm font-medium">{addon.label}</span>
                              <span className="shrink-0 text-sm font-medium">${addon.price}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-ink/55">
                              {addon.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="mt-4">
                      <label htmlFor="addon-discount" className="text-sm font-medium">
                        Discount code <span className="text-ink/50">(optional)</span>
                      </label>
                      <input
                        id="addon-discount"
                        type="text"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value)}
                        placeholder="Enter code"
                        autoComplete="off"
                        className="mt-1 w-full max-w-xs rounded-xl border border-ink/20 px-4 py-2.5 uppercase focus:border-accent focus:outline-none"
                      />
                      <p className="mt-1 text-xs text-ink/55">
                        Applied to whichever ticked items the code covers. Anything it
                        doesn&apos;t cover stays full price.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleAddOnCheckout()}
                      disabled={checkoutWorking || selectedAddOns.size === 0}
                      className="mt-3 w-full rounded-full bg-accent py-3 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 sm:w-auto sm:px-8"
                    >
                      {checkoutWorking
                        ? 'Opening…'
                        : selectedAddOns.size === 0
                          ? 'Select an add-on'
                          : `Continue to checkout · $${addOnTotal}`}
                    </button>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-ink/60">
                    Everything available for this event is already active.
                    {addOnEligible ? null : (
                      <>
                        {' '}Guest downloads need a Premium event or the{' '}
                        <Link href="/corporate" className="text-accent underline">
                          Corporate plan
                        </Link>
                        .
                      </>
                    )}
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

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-5">
                <div>
                  <p className="text-sm font-medium text-red-700">Delete event</p>
                  <p className="text-xs text-ink/55">
                    Permanently removes this event and all of its photos.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteEvent()}
                  disabled={deleting}
                  className="rounded-full border border-red-500 px-5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete event'}
                </button>
              </div>
            </div>

            <div className="mt-8">
              {guestDownloadsOn ? (
                <DownloadShareBuilder
                  event={event}
                  selectedIds={selectedApprovedIds}
                  approvedCount={approvedPhotoIds.length}
                  onSelectAll={() => setShareSelected(new Set(approvedPhotoIds))}
                  onClear={() => setShareSelected(new Set())}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-ink/20 bg-white px-4 py-5 text-sm text-ink/60">
                  Download-sharing QR codes let guests download a set of photos you
                  choose. They require guest downloads, which you can enable per event
                  as an add-on above (Premium and Corporate).
                </div>
              )}
            </div>

            <div className="mt-8">
              <AdminPhotoGrid
                photos={photos}
                onChanged={load}
                selectable={guestDownloadsOn}
                selectedIds={shareSelected}
                onToggleSelected={toggleShare}
              />
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
