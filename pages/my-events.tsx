import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { withAuthenticator } from '@aws-amplify/ui-react';
import { signOut } from 'aws-amplify/auth';
import Layout from '@/components/Layout';
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
  const router = useRouter();
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

  async function handleSignOut() {
    await signOut();
    await router.replace('/');
  }

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
    <Layout title="My events">
      <section className="py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-accent">
              Host dashboard
            </p>
            <h1 className="mt-1 font-display text-3xl font-extrabold">My events</h1>
            <p className="mt-2 text-ink/65">
              Open an event to manage uploads, download media, or update its QR code.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {admin ? (
              <Link href="/global-admin" className="rounded-full border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent hover:text-white">
                Global admin
              </Link>
            ) : null}
            <Link href="/account-security" className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent">
              Account security
            </Link>
            <button type="button" onClick={handleSignOut} className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium hover:border-red-500 hover:text-red-700">
              Sign out
            </button>
            <Link
              href="/create-event"
              className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-white hover:bg-night"
            >
              Create another event
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="mt-10 text-center text-ink/60">Loading your events…</p>
        ) : error ? (
          <p className="mt-8 rounded-xl bg-red-50 px-4 py-5 text-center text-red-700">{error}</p>
        ) : events.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-ink/20 bg-white px-6 py-12 text-center">
            <h2 className="font-display text-xl font-bold">No events yet</h2>
            <p className="mt-2 text-ink/60">Create your first event and its upload QR code.</p>
            <Link
              href="/create-event"
              className="mt-5 inline-block rounded-full bg-accent px-6 py-3 font-medium text-white hover:bg-accent/90"
            >
              Create an event
            </Link>
          </div>
        ) : (
          <>
            {downloadableEvents.length > 0 ? (
              <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-display font-bold">Download photos</p>
                  <p className="text-sm text-ink/60">
                    Check one or more events, then download them together as a ZIP (each
                    event in its own folder).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="rounded-full border border-ink/20 px-3 py-2 font-medium hover:border-accent"
                  >
                    {allSelected ? 'Unselect all' : 'Select all'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadSelected()}
                    disabled={zipping || selected.size === 0}
                    className="rounded-full bg-ink px-4 py-2 font-medium text-white hover:bg-night disabled:opacity-50"
                  >
                    {zipping
                      ? zipProgress || 'Preparing…'
                      : `Download selected (${selected.size})`}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {events.map((event) => {
              const tier = getTier(event.tier);
              const pending = event.paid === false;
              const isSelected = selected.has(event.id);
              return (
                <article
                  key={event.id}
                  className={`rounded-2xl border p-5 shadow-sm ${
                    pending ? 'border-amber-300 bg-amber-50/60' : 'border-ink/10 bg-white'
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
                          className="mt-1.5 h-5 w-5 shrink-0 accent-accent"
                        />
                      ) : null}
                      <div>
                        <h2 className="font-display text-xl font-bold">{event.name}</h2>
                        <p className="mt-1 text-sm text-ink/60">
                          {formatDate(event.date)} · {tier?.name ?? event.tier} plan
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
                      {event.eventCode}
                    </span>
                  </div>

                  {pending ? (
                    <>
                      <p className="mt-4 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
                        Payment incomplete — this event isn&apos;t active and can&apos;t
                        collect photos until payment is finished.
                      </p>
                      <div className="mt-5 grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          disabled={working === event.id}
                          onClick={() => void handleCompletePayment(event)}
                          className="rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-night disabled:opacity-50"
                        >
                          {working === event.id
                            ? 'Working…'
                            : `Complete payment · $${tier?.price ?? ''}`}
                        </button>
                        <button
                          type="button"
                          disabled={working === event.id}
                          onClick={() => void handleCancelEvent(event)}
                          className="rounded-full border border-red-300 px-4 py-2.5 text-center text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Cancel event
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {event.accessExpiresAt ? (
                        <p className="mt-4 text-sm text-ink/55">
                          Gallery access through{' '}
                          {new Date(event.accessExpiresAt).toLocaleDateString()}
                        </p>
                      ) : null}
                      <div className="mt-5 grid gap-2 sm:grid-cols-3">
                        <Link
                          href={`/event/${event.id}/admin#event-qr-code`}
                          className="rounded-full bg-accent px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-accent/90"
                        >
                          QR code
                        </Link>
                        <Link
                          href={`/event/${event.id}/admin`}
                          className="rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-night"
                        >
                          Manage event
                        </Link>
                        <Link
                          href={`/event/${event.id}`}
                          className="rounded-full border border-ink/20 px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
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
      </section>
    </Layout>
  );
}

export default withAuthenticator(MyEventsPage);
