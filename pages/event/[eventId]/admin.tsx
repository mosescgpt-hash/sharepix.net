import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import AdminPhotoGrid from '@/components/AdminPhotoGrid';
import GuestBookModeration from '@/components/GuestBookModeration';
import EventQRCode from '@/components/EventQRCode';
import DownloadShareBuilder from '@/components/DownloadShareBuilder';
import HostGuide from '@/components/HostGuide';
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
  setEventGuestDownloadsBlocked,
  setEventVideoUploads,
  startAddOnCheckout,
  type EventAddOnKey,
  updateEventDetails,
} from '@/lib/api';
import { CORPORATE_PLAN, GUEST_BOOK_ADDON_PRICE, LIVE_SLIDESHOW_ADDON_PRICE, extensionPrice, getTier, videosRemaining } from '@/lib/pricing';
import { eventLifecycle } from '@/lib/lifecycle';
import { guestBookAvailable, guestBookPurchasable } from '@/lib/guestBook';
import { parseEventLocation } from '@/lib/eventLocation';
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
  const [editCity, setEditCity] = useState('');
  const [editState, setEditState] = useState('');
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
  const [downloadsWorking, setDownloadsWorking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Optional discount code applied to the extension or slideshow add-on.
  const [discountCode, setDiscountCode] = useState('');

  // Download-QR share selection, built by toggling photos in the gallery below.
  const [shareSelected, setShareSelected] = useState<Set<string>>(new Set());
  const approvedPhotoIds = useMemo(
    () => photos.filter((photo) => photo.approved !== false).map((photo) => photo.id),
    [photos],
  );
  // Default the selection to the whole (approved) event whenever the photo set
  // changes, matching the old builder's behavior. Guest downloads ship with
  // every plan, so the share builder is always available.
  useEffect(() => {
    setShareSelected(new Set(approvedPhotoIds));
  }, [approvedPhotoIds]);
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
    const place = parseEventLocation(event.location);
    setEditCity(place.city);
    setEditState(place.state);
    setAlertEmail(event.alertEmail ?? '');
  }, [event]);

  const tier = event ? getTier(event.tier) : undefined;
  const hiddenCount = photos.filter((p) => p.approved === false).length;
  // Name/date can be edited only until the first photo lands. Prefer the
  // server-maintained counter, falling back to what we loaded.
  const photoCount = event?.photoCount ?? photos.length;
  const detailsLocked = photoCount > 0;
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
    if (!event.liveSlideshowEnabled) {
      items.push({
        key: 'live_slideshow',
        label: 'Live slideshow',
        price: LIVE_SLIDESHOW_ADDON_PRICE,
        description: 'Show photos on a screen at your venue as guests upload them.',
      });
    }
    // Premium and Corporate already include the guest book, and an event that
    // bought it is not offered it again. The checkout function re-derives both
    // server-side; this only decides what to show.
    if (guestBookPurchasable(event)) {
      items.push({
        key: 'guest_book',
        label: 'Guest book',
        price: GUEST_BOOK_ADDON_PRICE,
        description: 'Let guests leave a signed note, photo, or video message.',
      });
    }
    return items;
  }, [event]);

  const addOnTotal = availableAddOns
    .filter((addon) => selectedAddOns.has(addon.key))
    .reduce((sum, addon) => sum + addon.price, 0);

  const lifecycle = eventLifecycle(event);

  async function handleSaveDetails() {
    if (!event) return;
    setSavingDetails(true);
    setSettingsMsg(null);
    try {
      // Once photos exist the name and date are locked server-side, so only
      // send them while they're still editable — the location always goes.
      const updated = await updateEventDetails(event.id, {
        ...(detailsLocked ? {} : { name: editName, date: editDate }),
        city: editCity,
        state: editState,
      });
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

  async function handleGuestDownloads(blocked: boolean) {
    if (!event) return;
    setDownloadsWorking(true);
    setSettingsMsg(null);
    try {
      await setEventGuestDownloadsBlocked(event.id, blocked);
      setEvent({ ...event, guestDownloadsBlocked: blocked });
      setSettingsMsg({
        text: blocked
          ? 'Guests can view the gallery but not download. They now see viewing copies rather than full-size photos.'
          : 'Guests can download the photos again, at full resolution.',
        ok: true,
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The setting could not be updated.',
        ok: false,
      });
    } finally {
      setDownloadsWorking(false);
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
    <Layout title={event ? `Admin — ${event.name}` : 'Admin dashboard'} width="bleed">
      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="spx-inner">
        {loading ? (
          <p className="spx-body text-center">Loading dashboard&hellip;</p>
        ) : denied ? (
          <div className="mx-auto max-w-lg">
            <Notice tone="warn" label="Not your event">
              Only the event host or a sharepix.net global administrator can open this dashboard.
            </Notice>
          </div>
        ) : error ? (
          <div className="mx-auto max-w-lg">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : event ? (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="spx-eyebrow">Admin dashboard</p>
                <h1 className="spx-display mt-3">{event.name}</h1>
                <p className="mt-3 text-sm text-charcoal/60">
                  {event.tier === 'corporate' ? 'Corporate' : tier?.name ?? event.tier} plan ·
                  Event code {event.eventCode}
                  {lifecycle.uploadWindowEndsAt
                    ? ` · Uploads ${lifecycle.uploadOpen ? 'open until' : 'closed'} ${lifecycle.uploadWindowEndsAt.toLocaleDateString()}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setShowQR((v) => !v)}
                  className="border border-charcoal/25 px-4 py-2 font-medium text-charcoal transition hover:border-charcoal/60"
                >
                  {showQR ? 'Hide QR code' : 'Show QR code'}
                </button>
                <Link
                  href={`/event/${event.id}`}
                  className="border border-charcoal/25 px-4 py-2 font-medium text-charcoal transition hover:border-charcoal/60"
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
                    className="border border-pine px-4 py-2 font-medium text-pine transition hover:bg-pine/5"
                  >
                    Live slideshow &#8599;
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={load}
                  className="bg-ink px-4 py-2 font-medium text-canvas transition hover:bg-night"
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

            <div className="mt-8 grid grid-cols-2 gap-4 sm:max-w-md">
              <div className="spx-card p-5">
                <p className="spx-stat-figure">{photos.length}</p>
                <p className="spx-stat-label">Total photos</p>
              </div>
              <div className="spx-card p-5">
                <p className="spx-stat-figure">{hiddenCount}</p>
                <p className="spx-stat-label">Hidden from gallery</p>
              </div>
            </div>

            <HostGuide
              event={event}
              onShowQR={() => {
                setShowQR(true);
                window.setTimeout(
                  () => document.getElementById('event-qr-code')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                  50,
                );
              }}
            />

            <div className="spx-card mt-10 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Event settings</h2>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/event/${event.id}/table-tent`}
                    target="_blank"
                    className="border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60"
                  >
                    Table tent →
                  </Link>
                  <Link
                    href={`/event/${event.id}/brochure`}
                    target="_blank"
                    className="border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60"
                  >
                    Printable brochure →
                  </Link>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium">Event name</span>
                  <input
                    type="text"
                    value={editName}
                    disabled={detailsLocked || savingDetails}
                    onChange={(e) => setEditName(e.target.value)}
                    className="spx-input mt-2 disabled:bg-sand disabled:text-charcoal/50"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Event date</span>
                  <input
                    type="date"
                    value={editDate}
                    disabled={detailsLocked || savingDetails}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="spx-input mt-2 disabled:bg-sand disabled:text-charcoal/50"
                  />
                </label>
              </div>

              <div className="mt-4">
                <span className="text-sm font-medium">
                  Where it happened <span className="text-charcoal/50">(optional)</span>
                </span>
                <div className="mt-1 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <input
                    type="text"
                    value={editCity}
                    maxLength={60}
                    disabled={savingDetails}
                    onChange={(e) => setEditCity(e.target.value)}
                    placeholder="City"
                    aria-label="City"
                    className="spx-input disabled:bg-sand"
                  />
                  <input
                    type="text"
                    value={editState}
                    maxLength={40}
                    disabled={savingDetails}
                    onChange={(e) => setEditState(e.target.value)}
                    placeholder="State"
                    aria-label="State"
                    className="spx-input disabled:bg-sand"
                  />
                </div>
                <p className="mt-1 text-xs text-charcoal/60">
                  City and state only — never a street address. Photos&apos; own location data
                  is always removed when they&apos;re uploaded.
                </p>
              </div>

              {detailsLocked ? (
                <p className="mt-2 text-xs text-charcoal/60">
                  The name and date lock once the first photo is uploaded, so guests&apos;
                  memories keep the details they saw. You can still change the location.
                </p>
              ) : null}

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleSaveDetails}
                  disabled={savingDetails}
                  className="bg-ink px-5 py-3 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                >
                  {savingDetails ? 'Saving…' : 'Save details'}
                </button>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-5">
                <div>
                  <p className="text-sm font-medium">
                    Uploads are {event.uploadsClosed ? 'closed' : 'open'}
                  </p>
                  <p className="text-xs text-charcoal/60">
                    {event.uploadsClosed
                      ? 'Guests cannot add new photos. The gallery stays viewable.'
                      : 'Close the event when you have all the photos you want.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleClosed}
                  disabled={closing}
                  className={`px-5 py-3 text-sm font-medium transition disabled:opacity-50 ${
                    event.uploadsClosed
                      ? 'bg-ink text-canvas hover:bg-night'
                      : 'border border-red-400 text-red-700 hover:bg-red-50'
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
                <p className="text-xs text-charcoal/60">
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
                        className={`border px-4 py-2 text-sm transition disabled:opacity-50 ${
                          active
                            ? 'border-ink bg-ink text-canvas'
                            : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-charcoal/60">
                  {(event.moderationMode ?? 'review') === 'allow_all'
                    ? 'Nothing is screened or held back. Any photo a guest uploads appears right away — including on the slideshow.'
                    : 'A flagged photo is hidden from guests and the slideshow until you release it. Only you can see it.'}
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Guest downloads</p>
                    <p className="text-xs text-charcoal/60">
                      {event.guestDownloadsBlocked === true
                        ? 'Off — guests can view the gallery but not download, and they see smaller viewing copies rather than full-size photos. You still have everything at full resolution.'
                        : 'On. Guests can save the photos at full resolution, no account needed. Turn this off for an event where you would rather the pictures stayed with you.'}
                    </p>
                    {event.guestDownloadsBlocked === true ? (
                      <p className="mt-1 text-xs text-charcoal/60">
                        This lowers what a guest can take away — it cannot stop a screenshot.
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={downloadsWorking}
                    onClick={() => void handleGuestDownloads(event.guestDownloadsBlocked !== true)}
                    className="shrink-0 border border-charcoal/25 px-5 py-3 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                  >
                    {downloadsWorking
                      ? 'Saving…'
                      : event.guestDownloadsBlocked === true
                        ? 'Allow downloads'
                        : 'Turn off downloads'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Guest videos</p>
                    <p className="text-xs text-charcoal/60">
                      {event.videoUploadsEnabled === false
                        ? 'Off — guests can add photos only.'
                        : 'On. Videos are yours alone: guests can upload them but only you can watch them, which is also what keeps them from costing a fortune to serve. Screening checks photos but not videos, so turn this off if you want screened media only.'}
                    </p>
                    {event.videoUploadsEnabled !== false && event.videoLimit != null ? (
                      <p className="mt-1 text-sm text-charcoal/60">
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
                    className="shrink-0 border border-charcoal/25 px-5 py-3 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
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
                      <span className="text-charcoal/50">(optional)</span>
                    </label>
                    <p className="text-xs text-charcoal/60">
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
                        className="spx-input min-w-0 flex-1"
                      />
                      <button
                        type="button"
                        disabled={alertWorking}
                        onClick={() => void handleSaveAlertEmail()}
                        className="shrink-0 border border-charcoal/25 px-5 py-3 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                      >
                        {alertWorking ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 border-t border-ink/10 pt-5">
                <p className="text-sm font-medium">Add-ons</p>
                <p className="text-xs text-charcoal/60">
                  Tick what you want and pay once.{' '}
                  {lifecycle.uploadWindowEndsAt
                    ? lifecycle.uploadOpen
                      ? `Guests can upload until ${lifecycle.uploadWindowEndsAt.toLocaleDateString()}.`
                      : `The upload window closed on ${lifecycle.uploadWindowEndsAt.toLocaleDateString()}.`
                    : ''}
                </p>

                {/* Included on every plan — shown so the list reads as complete. */}
                <p className="mt-3 text-sm text-green-700">
                  ✓ Guest downloads — included, guests can download photos and videos.
                </p>
                {event.liveSlideshowEnabled ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-green-700">
                      ✓ Live slideshow — ready for the screen at your venue.
                    </p>
                    <Link
                      href={`/event/${event.id}/live`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 border border-pine px-4 py-2 text-sm font-medium text-pine transition hover:bg-pine/5"
                    >
                      Open slideshow ↗
                    </Link>
                  </div>
                ) : null}
                {guestBookAvailable(event) ? (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-green-700">
                      ✓ Guest book — guests can leave a signed note, photo, or video message.
                    </p>
                    <Link
                      href={`/event/${event.id}/guestbook`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 border border-pine px-4 py-2 text-sm font-medium text-pine transition hover:bg-pine/5"
                    >
                      Open guest book ↗
                    </Link>
                  </div>
                ) : null}

                {availableAddOns.length > 0 ? (
                  <>
                    <div className="mt-3 space-y-2">
                      {availableAddOns.map((addon) => (
                        <label
                          key={addon.key}
                          className={`flex cursor-pointer items-start gap-3 border p-4 transition ${
                            selectedAddOns.has(addon.key)
                              ? 'border-ink bg-sand'
                              : 'border-charcoal/15 hover:border-charcoal/40'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedAddOns.has(addon.key)}
                            onChange={() => toggleAddOn(addon.key)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-pine"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="text-sm font-medium">{addon.label}</span>
                              <span className="shrink-0 text-sm font-medium">${addon.price}</span>
                            </span>
                            <span className="mt-0.5 block text-xs text-charcoal/60">
                              {addon.description}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="mt-4">
                      <label htmlFor="addon-discount" className="text-sm font-medium">
                        Discount code <span className="text-charcoal/50">(optional)</span>
                      </label>
                      <input
                        id="addon-discount"
                        type="text"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value)}
                        placeholder="Enter code"
                        autoComplete="off"
                        className="spx-input mt-2 max-w-xs uppercase"
                      />
                      <p className="mt-1 text-xs text-charcoal/60">
                        Applied to whichever ticked items the code covers. Anything it
                        doesn&apos;t cover stays full price.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleAddOnCheckout()}
                      disabled={checkoutWorking || selectedAddOns.size === 0}
                      className="mt-4 w-full bg-ink py-3 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50 sm:w-auto sm:px-8"
                    >
                      {checkoutWorking
                        ? 'Opening…'
                        : selectedAddOns.size === 0
                          ? 'Select an add-on'
                          : `Continue to checkout · $${addOnTotal}`}
                    </button>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-charcoal/60">
                    Everything available for this event is already active.
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
                  <p className="text-xs text-charcoal/60">
                    Permanently removes this event and all of its photos.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteEvent()}
                  disabled={deleting}
                  className="border border-red-400 px-5 py-3 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete event'}
                </button>
              </div>
            </div>

            <div className="mt-8">
              <DownloadShareBuilder
                event={event}
                selectedIds={selectedApprovedIds}
                approvedCount={approvedPhotoIds.length}
                onSelectAll={() => setShareSelected(new Set(approvedPhotoIds))}
                onClear={() => setShareSelected(new Set())}
              />
            </div>

            {/* Below the photos: notes are the smaller half of the event, and
                a host opening this page is usually here for the pictures. */}
            {guestBookAvailable(event) ? <GuestBookModeration eventId={event.id} /> : null}

            <div className="mt-8">
              <AdminPhotoGrid
                photos={photos}
                onChanged={load}
                selectable
                selectedIds={shareSelected}
                onToggleSelected={toggleShare}
              />
            </div>
          </>
        ) : null}
        </div>
      </section>
    </Layout>
  );
}

// Cognito sign-in is required to reach this page at all;
// the owner check above then limits it to the event's host.
export default withAuthenticator(AdminDashboardPage);
