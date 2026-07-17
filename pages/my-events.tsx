import { useEffect, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import { listMyEvents } from '@/lib/api';
import { getTier } from '@/lib/pricing';
import { QREvent } from '@/lib/types';

function formatDate(value?: string | null) {
  if (!value) return 'Date not set';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function MyEventsPage() {
  const [events, setEvents] = useState<QREvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyEvents()
      .then(setEvents)
      .catch(() => setError('We could not load your events. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

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
          <Link
            href="/create-event"
            className="self-start rounded-full bg-ink px-6 py-3 font-medium text-white hover:bg-night sm:self-auto"
          >
            Create another event
          </Link>
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
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {events.map((event) => {
              const tier = getTier(event.tier);
              return (
                <article key={event.id} className="rounded-2xl border border-ink/10 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-xl font-bold">{event.name}</h2>
                      <p className="mt-1 text-sm text-ink/60">
                        {formatDate(event.date)} · {tier?.name ?? event.tier} plan
                      </p>
                    </div>
                    <span className="rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-accent">
                      {event.eventCode}
                    </span>
                  </div>
                  {event.accessExpiresAt ? (
                    <p className="mt-4 text-sm text-ink/55">
                      Gallery access through {new Date(event.accessExpiresAt).toLocaleDateString()}
                    </p>
                  ) : null}
                  <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                    <Link
                      href={`/event/${event.id}/admin`}
                      className="flex-1 rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-night"
                    >
                      Manage event
                    </Link>
                    <Link
                      href={`/event/${event.id}`}
                      className="flex-1 rounded-full border border-ink/20 px-4 py-2.5 text-center text-sm font-medium hover:border-accent hover:text-accent"
                    >
                      View gallery
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </Layout>
  );
}

export default withAuthenticator(MyEventsPage);
