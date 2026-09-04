import { useEffect, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import HostHeader from '@/components/HostHeader';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { deleteMyEvent, downloadEventsAsZip, listMyEvents, startCheckout } from '@/lib/api';
import { isGlobalAdmin } from '@/lib/admin';
import { getTier } from '@/lib/pricing';
import { QREvent } from '@/lib/types';

function formatDate(value?: string | null) {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function MyEventsPage() {
  const [events, setEvents] = useState<QREvent[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  // Multi-event bulk download.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState('');

  useEffect(() => {
    Promise.all([listMyEvents(), isGlobalAdmin().catch(() => false)])
      .then(([ownedEvents, globalAdmin]) => {
        setEvents(ownedEvents);
        setAdmin(globalAdmin);
      })
      .catch(() => setError('We could not load your events. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  async function handleCompletePayment(event: QREvent) {
    setWorking(event.id);
    setError(null);
    try {
      const url = await startCheckout(event.tier, event.id);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout could not be started.');
      setWorking(null);
    }
  }

  async function handleCancelEvent(event: QREvent) {
    if (!window.confirm(`Cancel and remove "${event.name}"? This can't be undone.`)) return;
    setWorking(event.id);
    setError(null);
    try {
      await deleteMyEvent(event.id);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(event.id);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event could not be removed.');
    } finally {
      setWorking(null);
    }
  }

  // Only active (paid) events have photos to download.
  const downloadableEvents = events.filter((event) => event.paid !== false);
  const allSelected =
    downloadableEvents.length > 0 && selected.size >= downloadableEvents.length;

  function toggleSelect(eventId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(downloadableEvents.map((e) => e.id)));
  }

  async function handleDownloadSelected() {
    const chosen = downloadableEvents
      .filter((event) => selected.has(event.id))
      .map((event) => ({ id: event.id, name: event.name }));
    if (chosen.length === 0) return;
    setZipping(true);
    setError(null);
    setZipProgress('Preparing…');
    try {
      const { skipped } = await downloadEventsAsZip(chosen, (completed, total) => {
        setZipProgress(`Adding ${completed} of ${total}…`);
      });
      if (skipped > 0) {
        setError(
          `${skipped} file${skipped === 1 ? '' : 's'} could not be found and ${skipped === 1 ? 'was' : 'were'} skipped; the rest downloaded.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The download could not be created.');
    } finally {
      setZipping(false);
      setZipProgress('');
    }
  }

  return (
    <Layout title="My events" width="bleed">
      <HostHeader
        eyebrow="Host dashboard"
        title="My events."
        serif="All in one place."
        description="Open an event to manage uploads, download media, or update its QR code."
        current="events"
        admin={admin}
        actions={
          <Link href="/create-event" className="spx-btn-canvas">
            Create another event
          </Link>
        }
      />

      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="spx-inner">
          {loading ? (
            <p className="spx-body text-center">Loading your events&hellip;</p>
          ) : error ? (
            <Notice tone="error">{error}</Notice>
          ) : events.length === 0 ? (
            <div className="spx-empty">
              <p className="spx-display-serif text-2xl">No events yet.</p>
              <p className="spx-body mt-2 max-w-sm text-sm">
                Create your first event and its upload QR code.
              </p>
              <Link href="/create-event" className="spx-btn-ink mt-6">
                Create an event
              </Link>
            </div>
          ) : (
            <>
              {downloadableEvents.length > 0 ? (
                <div className="spx-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-sans font-semibold text-charcoal">Download photos</p>
                    <p className="mt-1 text-sm text-charcoal/60">
                      Check one or more events, then download them together as a ZIP (each event
                      in its own folder).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="border border-charcoal/25 px-4 py-2 font-medium text-charcoal transition hover:border-charcoal/60"
                    >
                      {allSelected ? 'Unselect all' : 'Select all'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadSelected()}
                      disabled={zipping || selected.size === 0}
                      className="bg-ink px-4 py-2 font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                    >
                      {zipping ? zipProgress || 'Preparing…' : `Download selected (${selected.size})`}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {events.map((event) => {
                  const tier = getTier(event.tier);
                  const pending = event.paid === false;
                  const isSelected = selected.has(event.id);
                  return (
                    <article
                      key={event.id}
                      className={`border p-6 ${
                        // An unpaid event is marked by a left rule, the same
                        // way a warning Notice is, rather than by tinting the
                        // whole card — a full amber card outshouted the events
                        // that are actually running.
                        pending
                          ? 'border-charcoal/10 border-l-2 border-l-amber-600 bg-paper'
                          : 'border-charcoal/10 bg-paper'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {!pending ? (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(event.id)}
                              aria-label={`Select ${event.name} for download`}
                              className="mt-1.5 h-5 w-5 shrink-0 accent-pine"
                            />
                          ) : null}
                          <div>
                            <h2 className="font-sans text-xl font-bold tracking-[-0.02em]">
                              {event.name}
                            </h2>
                            <p className="mt-1 text-sm text-charcoal/60">
                              {formatDate(event.date)} · {tier?.name ?? event.tier} plan
                            </p>
                          </div>
                        </div>
                        <span className="shrink-0 bg-sand px-3 py-1 font-sans text-xs font-medium uppercase tracking-[0.14em] text-charcoal/70">
                          {event.eventCode}
                        </span>
                      </div>

                      {pending ? (
                        <>
                          <p className="mt-4 text-sm leading-relaxed text-charcoal/70">
                            <span className="font-medium text-amber-700">Payment incomplete.</span>{' '}
                            This event isn&rsquo;t active and can&rsquo;t collect photos until
                            payment is finished.
                          </p>
                          <div className="mt-5 grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              disabled={working === event.id}
                              onClick={() => void handleCompletePayment(event)}
                              className="bg-ink px-4 py-3 text-center text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                            >
                              {working === event.id
                                ? 'Working…'
                                : `Complete payment · $${tier?.price ?? ''}`}
                            </button>
                            <button
                              type="button"
                              disabled={working === event.id}
                              onClick={() => void handleCancelEvent(event)}
                              className="border border-red-300 px-4 py-3 text-center text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                            >
                              Cancel event
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          {event.accessExpiresAt ? (
                            <p className="mt-4 text-sm text-charcoal/60">
                              Gallery access through{' '}
                              {new Date(event.accessExpiresAt).toLocaleDateString()}
                            </p>
                          ) : null}
                          <div className="mt-5 grid gap-2 sm:grid-cols-3">
                            <Link
                              href={`/event/${event.id}/admin`}
                              className="bg-ink px-4 py-3 text-center text-sm font-medium text-canvas transition hover:bg-night"
                            >
                              Manage event
                            </Link>
                            <Link
                              href={`/event/${event.id}/admin#event-qr-code`}
                              className="border border-charcoal/25 px-4 py-3 text-center text-sm font-medium text-charcoal transition hover:border-charcoal/60"
                            >
                              QR code
                            </Link>
                            <Link
                              href={`/event/${event.id}`}
                              className="border border-charcoal/25 px-4 py-3 text-center text-sm font-medium text-charcoal transition hover:border-charcoal/60"
                            >
                              View gallery
                            </Link>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}

export default withAuthenticator(MyEventsPage);
