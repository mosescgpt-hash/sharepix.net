import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import GuestReferralLink from '@/components/GuestReferralLink';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import PhotoGrid from '@/components/PhotoGrid';
import EventCover from '@/components/EventCover';
import { resolveGalleryTheme, themeStyle } from '@/lib/galleryTheme';
import { commentsEnabled, likesEnabled } from '@/lib/photoEngagement';
import { fetchEvent, fetchEventMoments, fetchEventPhotos, getCurrentUserInfo } from '@/lib/api';
import { isGlobalAdmin } from '@/lib/admin';
import { eventLifecycle } from '@/lib/lifecycle';
import { canDownloadEventMedia, galleryVariantFor, isEventHost } from '@/lib/gallery';
import { DisplayPhoto, EventMoment, QREvent } from '@/lib/types';
import { guestBookAvailable } from '@/lib/guestBook';
import { groupPhotosByMoment } from '@/lib/moments';
import ChallengeChips from '@/components/challenges/ChallengeChips';
import { useEventChallenges } from '@/lib/challenges/useEventChallenges';

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
  const [moments, setMoments] = useState<EventMoment[]>([]);
  // Photo challenges: [] unless the host turned them on, so the chips and the
  // filter below are invisible on every other event.
  const challenges = useEventChallenges(event);
  const [challengeFilter, setChallengeFilter] = useState<string | null>(null);
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
      // Closed by SharePix for its content. Said plainly and without detail:
      // the server already refuses its media, and the reason is not a guest's
      // business. An admin still gets the gallery, to review it.
      if ((ev.takenDownAt || ev.hostDeletedAt) && !(await isGlobalAdmin().catch(() => false))) {
        setError(
          ev.hostDeletedAt ? 'We couldn’t find that event.' : 'This event is no longer available.',
        );
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
      // Never fatal. A gallery that cannot load its labels is still a gallery.
      setMoments(await fetchEventMoments(eventId).catch(() => []));
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
  // The host's chosen fonts, layout and accent. Total for an event that has
  // never been styled, one with a stale value, and one created before this
  // existed — all three resolve to the SharePix default.
  const theme = resolveGalleryTheme(event);
  // Both default ON for an event that has never been asked — see
  // lib/photoEngagement.ts for why they are switches at all.
  const likesOn = likesEnabled(event);
  const commentsOn = commentsEnabled(event);
  // The challenge chip's filter. A filter that no longer matches anything
  // (its challenge was deleted, or switched off) shows everything.
  const filtered = challengeFilter ? photos.filter((p) => p.challengeId === challengeFilter) : photos;
  const shown = filtered.length > 0 ? filtered : photos;

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
        // The theme is applied as CSS custom properties on a wrapper rather
        // than by swapping classes: every value has been validated, and this
        // way a stored value can never become markup. See lib/galleryTheme.ts.
        <div style={themeStyle(theme)} className="spx-themed-event">
          {/* The event's own name is the headline, over the host's cover
              photo or background — the navy band when they chose neither. */}
          <EventCover
            event={event}
            eyebrow={
              <>
                {photos.length} {photos.length === 1 ? 'memory' : 'memories'} shared
              </>
            }
            meta={
              event.location ? (
                <p className="spx-display-serif mt-1 text-2xl sm:text-3xl">{event.location}</p>
              ) : null
            }
          >
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
          </EventCover>

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
                {canSee && photos.length > 0 ? (
                  <ChallengeChips
                    challenges={challenges}
                    photos={photos}
                    selectedId={challengeFilter}
                    onSelect={setChallengeFilter}
                  />
                ) : null}
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
                ) : moments.length === 0 || shown !== photos ? (
                  // One grid while a challenge filter is on, too: grouping a
                  // filtered set by moment would be mostly empty headings.
                  <PhotoGrid
                    photos={shown}
                    canDownload={canDownload}
                    canViewOriginal={host || admin}
                    eventName={event.name}
                    eventId={event.id}
                    layout={theme.layout}
                    likesOn={likesOn}
                    commentsOn={commentsOn}
                  />
                ) : (
                  // Grouped only when the host actually set moments up. With
                  // none, this page renders exactly as it did before moments
                  // existed — one grid, no headings, nothing to explain.
                  <div className="space-y-14">
                    {groupPhotosByMoment(shown, moments).map((group) => (
                      <section key={group.moment?.id ?? 'unfiled'}>
                        <h2 className="spx-display-serif text-3xl">
                          {group.moment ? group.moment.name : 'Everything else'}
                        </h2>
                        {group.moment?.description ? (
                          <p className="spx-body mt-1 text-sm">{group.moment.description}</p>
                        ) : null}
                        <div className="mt-5">
                          <PhotoGrid
                            photos={group.photos}
                            canDownload={canDownload}
                            canViewOriginal={host || admin}
                            eventName={event.name}
                            eventId={event.id}
                            layout={theme.layout}
                            likesOn={likesOn}
                            commentsOn={commentsOn}
                            emptyMessage={
                              group.moment
                                ? `Nothing from ${group.moment.name} yet.`
                                : undefined
                            }
                          />
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>

              {/* The guest-to-host loop. Never shown to the host or an admin
                  looking at their own event — see components/GuestReferralLink.tsx. */}
              {!privileged && canSee ? <GuestReferralLink source="gallery" /> : null}
            </div>
          </section>
        </div>
      ) : null}
    </Layout>
  );
}
