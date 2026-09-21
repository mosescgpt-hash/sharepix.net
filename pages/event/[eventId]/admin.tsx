import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import AdminPhotoGrid from '@/components/AdminPhotoGrid';
import GuestBookModeration from '@/components/GuestBookModeration';
import MomentsManager from '@/components/MomentsManager';
import EventQRCode from '@/components/EventQRCode';
import GalleryStyleSettings from '@/components/GalleryStyleSettings';
import CommentModeration from '@/components/CommentModeration';
import { commentsEnabled } from '@/lib/photoEngagement';
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
  setEventUploadAudience,
  setEventUploadsClosed,
  setEventGuestDownloadsBlocked,
  setEventVideoUploads,
  claimGuestUploadPromise,
  connectPhotographer,
  fetchEventPhotographers,
  requestEventCapacity,
  startAddOnCheckout,
  type EventAddOnKey,
  updateEventDetails,
} from '@/lib/api';
import {
  PAIRING_CODE_TTL_MINUTES,
  formatPairingCode,
} from '@/lib/photographerAccess';
import {
  ATTESTATION_QUESTION,
  PLANNED_USE_OPTIONS,
  PLANNED_USE_QUESTION,
} from '@/lib/guestUploadPromise';
import {
  CORPORATE_PLAN,
  GUEST_BOOK_ADDON_PRICE,
  LIVE_SLIDESHOW_ADDON_PRICE,
  canPurchaseFor,
  extensionPrice,
  getTier,
  liveSlideshowAvailable,
  videosRemaining,
} from '@/lib/pricing';
import { eventLifecycle } from '@/lib/lifecycle';
import { UPLOAD_WINDOW_DAYS, latestEventDate } from '@/lib/uploadWindowStart';
import { guestBookAvailable, guestBookPurchasable } from '@/lib/guestBook';
import { parseEventLocation } from '@/lib/eventLocation';
import { DisplayPhoto, QREvent } from '@/lib/types';
import { isGlobalAdmin } from '@/lib/admin';
import { capacityRequestState } from '@/lib/fairUse';
import {
  AUDIENCE_HELP,
  AUDIENCE_OPTIONS,
  AUDIENCE_QUESTION,
  parseAudience,
  signHeadline,
} from '@/lib/eventAudience';

/**
 * The three bands the dashboard is laid out in, in the order a host meets them.
 *
 * It used to be a flat scroll of fourteen cards in roughly the order they were
 * built: the font picker first, the QR code below it, the instructions seventh
 * and collapsed, Moments — which mints its own QR codes — eleventh, and Delete
 * event sharing a card with Event name.
 *
 * The bands answer three different questions, and a host is only ever asking
 * one of them:
 *
 *   share    Getting guests in. The QR code, the printables, the moments.
 *   watch    What is happening now. Counts, moderation queues, the photos.
 *   setup    Everything you touch once. Details, style, safety, add-ons.
 *
 * Headed sections with ids rather than tabs, so the page is still one scroll
 * and one Ctrl-F — a host hunting for "where do I turn off videos" should not
 * have to guess which tab it is behind.
 */
const BANDS = [
  { id: 'share', label: 'Share it', blurb: 'The code, the signs, and the moments.' },
  { id: 'watch', label: 'Watch it', blurb: 'What your guests have added so far.' },
  { id: 'setup', label: 'Set it up', blurb: 'Details, style, and everything optional.' },
] as const;

/**
 * Which settings card a confirmation belongs to.
 *
 * `danger` covers closing and deleting: both live in the last card, and both
 * are things a host wants confirmed where they clicked.
 */
type SettingsScope = 'details' | 'guests' | 'addons' | 'danger';

function AdminDashboardPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  // Read after mount: `window` does not exist during the server render, and the
  // printed moment QR codes need an absolute URL.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const [event, setEvent] = useState<QREvent | null>(null);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Event-settings panel state (edit name/date, close/reopen uploads).
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editState, setEditState] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [closing, setClosing] = useState(false);
  // One message, but it now records which card raised it. The settings used to
  // be a single card with the confirmation at the bottom, so saving the event
  // name put "Event details updated" five hundred pixels below the field that
  // was saved. Split across four cards that would stop being merely unhelpful
  // and start being wrong.
  const [settingsMsg, setSettingsMsg] = useState<
    { text: string; ok: boolean; where: SettingsScope } | null
  >(null);
  const [corporateActive, setCorporateActive] = useState(false);
  // One cart for the paid add-ons: tick what you want, pay once.
  const [selectedAddOns, setSelectedAddOns] = useState<Set<EventAddOnKey>>(new Set());
  const [checkoutWorking, setCheckoutWorking] = useState(false);
  const [moderationWorking, setModerationWorking] = useState(false);
  const [alertEmail, setAlertEmail] = useState('');
  const [alertWorking, setAlertWorking] = useState(false);
  const [videoWorking, setVideoWorking] = useState(false);
  const [downloadsWorking, setDownloadsWorking] = useState(false);
  const [audienceWorking, setAudienceWorking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Optional discount code applied to the extension or slideshow add-on.
  const [discountCode, setDiscountCode] = useState('');
  // Guest Upload Promise claim. `promiseOpen` is the disclosure: the form is
  // behind a link rather than on the page, so nothing is offered unasked.
  // SharePix Pro: the pairing code is shown once, by the call that makes it.
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [photographers, setPhotographers] = useState<
    Awaited<ReturnType<typeof fetchEventPhotographers>>
  >([]);
  const [promiseOpen, setPromiseOpen] = useState(false);
  const [plannedUse, setPlannedUse] = useState('');
  const [attested, setAttested] = useState(false);
  const [claimNote, setClaimNote] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ text: string; ok: boolean } | null>(null);

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
      // Separately caught: a host whose photographer list fails to load should
      // still get their dashboard, not an error page.
      setPhotographers(await fetchEventPhotographers(eventId).catch(() => []));
    } catch {
      setError('Something went wrong loading the dashboard. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Bring the QR code into view.
   *
   * It used to also have to reveal it: the code sat behind a Show/Hide toggle,
   * so the guide's "open it here" link had to flip that before it could scroll.
   * The code is now the first thing in "Share it" and never hidden, so all that
   * is left is the scroll.
   */
  const scrollToQR = useCallback(() => {
    document
      .getElementById('event-qr-code')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    if (!event || !router.asPath.endsWith('#event-qr-code')) return;
    // A beat, so the card has been laid out before we scroll to where it is.
    const timer = window.setTimeout(scrollToQR, 100);
    return () => window.clearTimeout(timer);
  }, [event, router.asPath, scrollToQR]);

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
  const capacityState = capacityRequestState({ ...event, photoCount });
  const [capacityWorking, setCapacityWorking] = useState(false);
  const [capacityMessage, setCapacityMessage] = useState('');

  async function handleRequestCapacity() {
    setCapacityWorking(true);
    const result = await requestEventCapacity(eventId ?? '');
    setCapacityMessage(result.message);
    setCapacityWorking(false);
    // Reload so a successful request flips the card to its pending state from
    // the row rather than from local state, which would not survive a refresh.
    if (result.ok) void load();
  }

  const detailsLocked = photoCount > 0;
  // What this event can still buy. Extensions only apply to the fixed-length
  // plans (a corporate event has no plan price to halve), and each add-on drops
  // off the list once it's active.
  const availableAddOns = useMemo(() => {
    if (!event) return [];
    // A free event has bought nothing, so nothing may be sold against it. The
    // checkout function refuses it outright — the free tier is absent from its
    // price table — so this only keeps the page from offering what the server
    // would then reject.
    if (!canPurchaseFor(event.tier)) return [];
    const items: { key: EventAddOnKey; label: string; price: number; description: string }[] = [];
    if (getTier(event.tier)) {
      items.push({
        key: 'extend',
        label: 'Extend upload window (+30 days)',
        price: extensionPrice(event.tier),
        description: 'Give guests another 30 days to add photos.',
      });
    }
    // Never offered to a plan that already includes it. The checkout
    // function re-derives the same thing, so this only saves a wasted click.
    if (!liveSlideshowAvailable(event)) {
      items.push({
        key: 'live_slideshow',
        label: 'Live slideshow',
        price: LIVE_SLIDESHOW_ADDON_PRICE,
        description: 'Show photos on a screen at your venue as guests upload them.',
      });
    }
    // Plus and Corporate already include the guest book, and an event that
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

  async function handleInvitePhotographer() {
    if (!event) return;
    setInviting(true);
    try {
      const result = await connectPhotographer({ action: 'invite', eventId: event.id });
      // The only moment this value exists outside the database. Nothing can
      // read it back, so it is held in state rather than re-fetched.
      setPairingCode(result.code);
    } catch {
      setPairingCode(null);
    } finally {
      setInviting(false);
    }
  }

  async function handleRemovePhotographer(photographerId: string) {
    if (!event) return;
    if (
      !window.confirm(
        'Remove this photographer?\n\nThey stop being able to send or publish photos straight away. Photos already live stay live — take those down individually if you need to.',
      )
    ) {
      return;
    }
    await connectPhotographer({ action: 'remove', eventId: event.id, photographerId }).catch(
      () => null,
    );
    setPhotographers(await fetchEventPhotographers(event.id).catch(() => []));
  }

  async function handleClaimPromise() {
    if (!event) return;
    setClaiming(true);
    setClaimResult(null);
    try {
      const result = await claimGuestUploadPromise(event.id, plannedUse, attested, claimNote);
      setClaimResult({ text: result.message, ok: result.filed });
    } catch (err) {
      setClaimResult({
        text: err instanceof Error ? err.message : 'That claim could not be filed.',
        ok: false,
      });
    } finally {
      setClaiming(false);
    }
  }

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
      setSettingsMsg({ text: 'Event details updated.', ok: true, where: 'details' });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The event could not be updated.',
        ok: false,
        where: 'details',
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
        where: 'danger',
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The event could not be updated.',
        ok: false,
        where: 'danger',
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
        where: 'guests',
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The setting could not be updated.',
        ok: false,
        where: 'guests',
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
        where: 'guests',
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The setting could not be updated.',
        ok: false,
        where: 'guests',
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
        where: 'guests',
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The alert email could not be saved.',
        ok: false,
        where: 'guests',
      });
    } finally {
      setAlertWorking(false);
    }
  }

  /**
   * Change who the signs are addressed to.
   *
   * Nothing about the event's behaviour changes — guests of a 'host-only' event
   * can still upload if they reach the page — so the confirmation talks about
   * the signs rather than about permissions a host has not been given.
   */
  async function handleAudience(audience: 'guests' | 'host-only') {
    if (!event || parseAudience(event.uploadAudience) === audience) return;
    setAudienceWorking(true);
    setSettingsMsg(null);
    try {
      await setEventUploadAudience(event.id, audience);
      setEvent({ ...event, uploadAudience: audience });
      setSettingsMsg({
        text: `Your signs will now say “${signHeadline(audience)}”. Reprint the table tent or brochure to pick it up.`,
        ok: true,
        where: 'guests',
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The setting could not be updated.',
        ok: false,
        where: 'guests',
      });
    } finally {
      setAudienceWorking(false);
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
        where: 'guests',
      });
    } catch (err) {
      setSettingsMsg({
        text: err instanceof Error ? err.message : 'The setting could not be updated.',
        ok: false,
        where: 'guests',
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
        where: 'addons',
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
        where: 'danger',
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
                <Link
                  href={`/event/${event.id}`}
                  className="border border-charcoal/25 px-4 py-2 font-medium text-charcoal transition hover:border-charcoal/60"
                >
                  Public gallery
                </Link>
                {/* Opens in its own tab so the venue screen can run the
                    slideshow while the host keeps managing the event here. */}
                {liveSlideshowAvailable(event) ? (
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

            {/* A map for six screens of scroll. Anchors rather than tabs:
                everything stays on one page, so Ctrl-F still finds a setting
                and a link to a section still lands on it. */}
            <nav aria-label="Sections" className="mt-8 flex flex-wrap gap-2 text-sm">
              {BANDS.map((band) => (
                <a
                  key={band.id}
                  href={`#${band.id}`}
                  className="border border-charcoal/20 px-4 py-2 font-medium text-charcoal transition hover:border-charcoal/60"
                >
                  {band.label}
                </a>
              ))}
            </nav>

            {/* Expanded and first when the event has no photos yet: on day one
                a host needs the instructions and very little else. Once photos
                exist it drops to the quiet strip at the end of "Share it",
                where a host who has done this before never has to open it. */}
            {photos.length === 0 ? (
              <HostGuide event={event} defaultOpen onShowQR={scrollToQR} />
            ) : null}

            <section id="share" className="scroll-mt-24 pt-12">
              <p className="spx-eyebrow">{BANDS[0].label}</p>
              <p className="mt-2 text-sm text-charcoal/60">{BANDS[0].blurb}</p>

              {/* First thing in the band, and never hidden. It used to render
                  below the gallery-style card, behind a Show/Hide button — so
                  the first thing on the page was a font picker and the thing a
                  host actually came for was a click away. */}
              <div id="event-qr-code" className="mx-auto mt-6 max-w-sm scroll-mt-24">
                <EventQRCode
                  eventId={event.id}
                  eventName={event.name}
                  allowCustomization={tier?.customQrCode === true}
                  branding={event}
                  uploadAudience={event.uploadAudience}
                  // Re-read the event so the saved style is what the moment
                  // codes and the print pages pick up straight away.
                  onBrandingSaved={load}
                />
              </div>

              {/* The printables, beside the code they print. They used to be
                  two links in the header of the settings card, four screens
                  below the QR code they carry. */}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
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

              {/* Moments mint their own QR codes, one per part of the event,
                  so they belong beside the main code rather than eight
                  sections below it — which is where they were. */}
              <MomentsManager eventId={event.id} origin={origin} branding={event} />

              {photos.length > 0 ? (
                <HostGuide event={event} onShowQR={scrollToQR} />
              ) : null}
            </section>

            <section id="watch" className="scroll-mt-24 pt-12">
              <p className="spx-eyebrow">{BANDS[1].label}</p>
              <p className="mt-2 text-sm text-charcoal/60">{BANDS[1].blurb}</p>

              <div className="mt-6 grid grid-cols-2 gap-4 sm:max-w-md">
                <div className="spx-card p-5">
                  <p className="spx-stat-figure">{photos.length}</p>
                  <p className="spx-stat-label">Total photos</p>
                </div>
                <div className="spx-card p-5">
                  <p className="spx-stat-figure">{hiddenCount}</p>
                  <p className="spx-stat-label">Hidden from gallery</p>
                </div>
              </div>

              {/* Only from CAPACITY_ASK_PHOTOS. Below it there is nothing to
                  ask for and offering implies a limit the host has not met. */}
              {capacityState !== 'hidden' ? (
                <div className="spx-card mt-8 p-5">
                  <h2 className="font-sans text-lg font-bold tracking-[-0.02em]">
                    {capacityState === 'granted' ? 'Extra room added' : 'A big event'}
                  </h2>
                  {capacityState === 'granted' ? (
                    <p className="mt-2 text-sm text-charcoal/70">
                      We have added extra room to this event. Carry on — nothing is going to
                      stop.
                    </p>
                  ) : capacityState === 'pending' ? (
                    <p className="mt-2 text-sm text-charcoal/70">
                      We have your request and will be in touch by email. Uploads are not
                      paused and nothing is waiting on our reply.
                    </p>
                  ) : (
                    <>
                      {/* Worded as an offer, not a warning. Nothing stops at this
                          number and the honest thing is to say so first. */}
                      <p className="mt-2 text-sm text-charcoal/70">
                        Your guests have added{' '}
                        <strong className="font-semibold text-charcoal">
                          {photoCount.toLocaleString()}
                        </strong>{' '}
                        photos, which puts this among the larger events on SharePix. Nothing
                        is capped and nothing is going to stop — but if you are expecting a
                        lot more, tell us and we will make sure there is room.
                      </p>
                      {capacityMessage ? (
                        <Notice tone="success" className="mt-3">
                          {capacityMessage}
                        </Notice>
                      ) : (
                        <button
                          type="button"
                          disabled={capacityWorking}
                          onClick={() => void handleRequestCapacity()}
                          className="spx-btn-outline mt-4 disabled:opacity-50"
                        >
                          {capacityWorking ? 'Sending…' : 'Ask for more room'}
                        </button>
                      )}
                    </>
                  )}
                </div>
              ) : null}

              {/* Only when the event actually has comments on. A moderation
                  queue for a feature the host switched off is a panel that
                  explains nothing and worries them. */}
              {commentsEnabled(event) ? (
                <div className="mt-8">
                  <CommentModeration eventId={event.id} />
                </div>
              ) : null}

              {guestBookAvailable(event) ? <GuestBookModeration eventId={event.id} /> : null}

              <div className="mt-6">
                <DownloadShareBuilder
                  event={event}
                  selectedIds={selectedApprovedIds}
                  approvedCount={approvedPhotoIds.length}
                  onSelectAll={() => setShareSelected(new Set(approvedPhotoIds))}
                  onClear={() => setShareSelected(new Set())}
                />
              </div>

              <div className="mt-6">
                <AdminPhotoGrid
                  photos={photos}
                  onChanged={load}
                  selectable
                  selectedIds={shareSelected}
                  onToggleSelected={toggleShare}
                />
              </div>
            </section>

            <section id="setup" className="scroll-mt-24 pt-12">
              <p className="spx-eyebrow">{BANDS[2].label}</p>
              <p className="mt-2 text-sm text-charcoal/60">{BANDS[2].blurb}</p>

              {/* Name, date and place, in a card of their own. These used to
                  open a single settings card that ran to three screens and
                  ended with Delete event. */}
              <div className="spx-card mt-6 p-6">
                <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Event details</h2>
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
                      // Same ceiling the server applies on save. The window
                      // follows this date while the event has no photos, so a
                      // date nobody could reach is a save that fails for a
                      // reason the form never mentioned.
                      max={latestEventDate()}
                      className="spx-input mt-2 disabled:bg-sand disabled:text-charcoal/50"
                    />
                    {!detailsLocked ? (
                      <span className="mt-1.5 block text-sm text-charcoal/70">
                        Uploads run for {UPLOAD_WINDOW_DAYS} days from this date. It locks
                        once the first photo arrives.
                      </span>
                    ) : null}
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
                {/* Confirmations land in the card that raised them. */}
                {settingsMsg?.where === 'details' ? (
                  <p
                    className={`mt-4 text-sm ${settingsMsg.ok ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {settingsMsg.text}
                  </p>
                ) : null}
              </div>

              {/* Fonts, layout and accent colour. Down here rather than at the
                  top of the page, where it used to be the first thing a host
                  met: this is a thing you set once and it should not stand
                  between anyone and their QR code. */}
              <div className="mt-6">
                <GalleryStyleSettings event={event} onSaved={load} />
              </div>

              <div className="spx-card mt-6 p-6">
                <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">
                  What guests can do
                </h2>
                {/* First in this card, because it decides what the printed
                    signs say and a host is most likely to want it before the
                    event rather than after. */}
                <div className="mt-4">
                  <p className="text-sm font-medium">{AUDIENCE_QUESTION}</p>
                  <p className="text-xs text-charcoal/60">{AUDIENCE_HELP}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {AUDIENCE_OPTIONS.map((option) => {
                      const active = parseAudience(event.uploadAudience) === option.value
                        // An event created before the question keeps the guest
                        // wording, so that is the button that reads as chosen.
                        || (event.uploadAudience == null && option.value === 'guests');
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={audienceWorking}
                          onClick={() => void handleAudience(option.value)}
                          className={`border px-4 py-2 text-sm transition disabled:opacity-50 ${
                            active
                              ? 'border-ink bg-ink text-canvas'
                              : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-charcoal/60">
                    Your signs will say &ldquo;{signHeadline(parseAudience(event.uploadAudience))}
                    &rdquo;. Reprint the table tent or brochure after changing this.
                  </p>
                </div>

                <div className="mt-4 border-t border-ink/10 pt-4">
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
                {/* Confirmations land in the card that raised them. */}
                {settingsMsg?.where === 'guests' ? (
                  <p
                    className={`mt-4 text-sm ${settingsMsg.ok ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {settingsMsg.text}
                  </p>
                ) : null}
              </div>

              {/* SharePix Pro. Always here, because a host books a photographer
                  before the event rather than after it — unlike Featured Events
                  below, which needs photos to exist first. */}
              <div className="spx-card mt-6 p-6">
                <p className="spx-eyebrow">SharePix Pro</p>
                <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.02em]">
                  Add your photographer
                </h2>
                <p className="spx-body mt-2 text-sm">
                  Their photos appear in this gallery within minutes of being taken, as
                  previews they approve one by one. Guests can see them but not download
                  them, so the photographer keeps their originals and their print sales.
                </p>

                {pairingCode ? (
                  <div className="mt-4 border border-pine/40 bg-sage/30 p-4">
                    <p className="text-sm font-medium">Give this to your photographer</p>
                    <p className="mt-2 font-mono text-2xl tracking-widest">
                      {formatPairingCode(pairingCode)}
                    </p>
                    <p className="mt-2 text-xs text-charcoal/70">
                      They enter it at sharepix.net/pro/join. It works once and expires in{' '}
                      {PAIRING_CODE_TTL_MINUTES} minutes — we cannot show it again, but you
                      can make another.
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={inviting}
                  onClick={() => void handleInvitePhotographer()}
                  className="mt-4 border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                >
                  {inviting ? 'Making a code…' : pairingCode ? 'Make another code' : 'Invite a photographer'}
                </button>

                {photographers.length > 0 ? (
                  <ul className="mt-5 divide-y divide-charcoal/10 border-y border-charcoal/10">
                    {photographers.map((row) => (
                      <li
                        key={row.photographerId}
                        className="flex items-center justify-between gap-3 py-2.5"
                      >
                        <span className="min-w-0 truncate text-sm">
                          {row.status === 'accepted'
                            ? row.livePublishing
                              ? 'Connected · publishing'
                              : 'Connected · paused'
                            : row.status}
                        </span>
                        {row.status === 'accepted' ? (
                          <button
                            type="button"
                            onClick={() => void handleRemovePhotographer(row.photographerId)}
                            className="shrink-0 text-xs text-charcoal/60 underline hover:text-charcoal"
                          >
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="spx-card mt-6 p-6">
                <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">Add-ons</h2>
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
                {liveSlideshowAvailable(event) ? (
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
                {/* Confirmations land in the card that raised them. */}
                {settingsMsg?.where === 'addons' ? (
                  <p
                    className={`mt-4 text-sm ${settingsMsg.ok ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {settingsMsg.text}
                  </p>
                ) : null}
              </div>

              {/* Only once there is something to offer. Asking a host to submit
                  photos from an empty gallery is asking for nothing, and the
                  page they would land on would have no tiles to choose from. */}
              {photos.length > 0 ? (
                <div className="spx-card mt-6 p-6">
                  <p className="spx-eyebrow">Featured Events</p>
                  <h2 className="mt-2 font-sans text-xl font-bold tracking-[-0.02em]">
                    Show future hosts what this looked like
                  </h2>
                  <p className="mt-2 text-sm text-charcoal/70">
                    If you are happy with how this went, you can offer us a few photos to use
                    in our own marketing — and get some of what you paid back. You choose which
                    photos, nothing is published unless we come back to you about it, and you
                    can change your mind at any time.
                  </p>
                  <Link href={`/featured/${event.id}`} className="spx-btn-outline mt-4">
                    See what is involved
                  </Link>
                </div>
              ) : null}

              {/* Something went wrong.

                  Always here, never announced. v1 put "No guests uploaded
                  anything — that is not what you paid for" on the dashboard of
                  every event that qualified, which meant a church sharing
                  photos with parents, exactly as they planned, was told their
                  event had failed and offered their money back for it.

                  So the offer is gone and the door stays open: one quiet line
                  a host finds when they are looking for it, on every event
                  whatever its counts. What happens after they open it is
                  decided server-side; this only decides what is on screen.

                  Not a card, unlike everything else in this band. A bordered
                  panel headed "Something not right?" would be exactly the
                  announcement the paragraph above says we are not making. */}
              <div className="mt-8">
                {!promiseOpen ? (
                  <button
                    type="button"
                    onClick={() => setPromiseOpen(true)}
                    className="text-xs text-charcoal/60 underline transition hover:text-charcoal"
                  >
                    Something not right with this event?
                  </button>
                ) : (
                  <div>
                    <p className="text-sm font-medium">Something not right?</p>
                    {claimResult ? (
                      <Notice tone={claimResult.ok ? 'success' : 'warn'} className="mt-3">
                        {claimResult.text}
                      </Notice>
                    ) : (
                      <>
                        <fieldset className="mt-3">
                          <legend className="text-xs text-charcoal/75">
                            {PLANNED_USE_QUESTION}
                          </legend>
                          <div className="mt-2 space-y-1.5">
                            {PLANNED_USE_OPTIONS.map((option) => (
                              <label
                                key={option.value}
                                className="flex items-start gap-2 text-xs text-charcoal/75"
                              >
                                <input
                                  type="radio"
                                  name="plannedUse"
                                  className="mt-0.5"
                                  // Nothing pre-selected. A default here would
                                  // answer the question for them, and this is
                                  // the one fact the form exists to collect.
                                  checked={plannedUse === option.value}
                                  onChange={() => setPlannedUse(option.value)}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* The attestation appears only once they have said
                            guests were meant to upload. A host who planned to
                            upload alone is answered by the server instead, and
                            never shown a statement they have no reason to
                            sign. */}
                        {plannedUse === 'guests-upload' ? (
                          <label className="mt-3 flex items-start gap-2 text-xs text-charcoal/75">
                            <input
                              type="checkbox"
                              checked={attested}
                              onChange={(e) => setAttested(e.target.checked)}
                              className="mt-0.5"
                            />
                            <span>{ATTESTATION_QUESTION}</span>
                          </label>
                        ) : null}

                        <textarea
                          value={claimNote}
                          onChange={(e) => setClaimNote(e.target.value)}
                          rows={2}
                          maxLength={500}
                          placeholder="What happened? (optional)"
                          className="spx-input mt-2 w-full text-sm"
                        />
                        <button
                          type="button"
                          disabled={!plannedUse || claiming}
                          onClick={() => void handleClaimPromise()}
                          className="mt-2 border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                        >
                          {claiming ? 'Sending…' : 'Send'}
                        </button>
                        <p className="mt-2 text-xs text-charcoal/55">
                          We read these by hand.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Closing and deleting, alone at the bottom in a card that
                  looks like what it is. Delete event used to share a card
                  with the Event name field. */}
              <div className="spx-card mt-6 border-red-200 p-6">
                <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">
                  Ending the event
                </h2>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
                {/* Confirmations land in the card that raised them. */}
                {settingsMsg?.where === 'danger' ? (
                  <p
                    className={`mt-4 text-sm ${settingsMsg.ok ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {settingsMsg.text}
                  </p>
                ) : null}
              </div>
            </section>
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
