import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { fetchMyProConnections } from '@/lib/api';

/**
 * A photographer's events.
 *
 * Only accepted connections lead anywhere: an invitation that has not been
 * accepted is shown as waiting rather than as a broken link, because a
 * photographer who clicks into an event they cannot use learns nothing about
 * why.
 */
export default function ProHomePage() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchMyProConnections>> | null>(null);

  useEffect(() => {
    void fetchMyProConnections()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  return (
    <Layout title="SharePix Pro">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-2xl">
          <p className="spx-eyebrow">SharePix Pro</p>
          <h1 className="mt-3">
            <span className="spx-display block">Live professional</span>
            <span className="spx-display-serif block">photography for events.</span>
          </h1>
          <p className="spx-body mt-5">
            Photos you approve appear in the event gallery within minutes, as reduced-resolution
            previews. Your originals stay yours — we delete them once the preview is made,
            unless you ask us to keep them.
          </p>

          <h2 className="spx-body mt-10 font-medium">Your events</h2>
          {rows === null ? (
            <p className="mt-3 text-sm text-charcoal/55">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="mt-3 border border-dashed border-charcoal/25 p-6 text-center text-sm text-charcoal/60">
              No events yet. A host adds you to theirs, and it appears here.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-charcoal/10 border-y border-charcoal/10">
              {rows.map((row) => (
                <li key={row.eventId} className="flex items-center justify-between gap-4 py-3">
                  <span className="min-w-0 truncate text-sm">{row.eventId}</span>
                  {row.status === 'accepted' ? (
                    <Link
                      href={`/pro/events/${row.eventId}/review`}
                      className="shrink-0 text-sm font-medium text-pine underline"
                    >
                      {row.livePublishing ? 'Review · live' : 'Review · paused'}
                    </Link>
                  ) : (
                    <span className="shrink-0 text-xs text-charcoal/55">{row.status}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </Layout>
  );
}
