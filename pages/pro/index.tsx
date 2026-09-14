import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { fetchMyProConnections, getCurrentUserInfo } from '@/lib/api';

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
  // Signed out and "no events yet" produced the same empty list, so a
  // photographer who simply was not logged in was told a host had not added
  // them. Two different problems, two different answers.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      const user = await getCurrentUserInfo().catch(() => null);
      setSignedIn(Boolean(user));
      if (!user) {
        setRows([]);
        return;
      }
      setRows(await fetchMyProConnections().catch(() => []));
    })();
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

          {/* The first thing a photographer needs, because they almost always
              arrive holding a code the host just read out to them. Above the
              event list on purpose: the list is empty the first time. */}
          <div className="mt-8 border border-ink/15 bg-sage/25 p-5">
            <p className="spx-body font-medium">Got a pairing code?</p>
            <p className="mt-1 text-sm text-charcoal/70">
              The host generates one from their event dashboard. It works once and expires
              quickly.
            </p>
            <Link href="/pro/join" className="spx-btn-ink mt-4">
              Join an event
            </Link>
          </div>

          <h2 className="spx-body mt-10 font-medium">Your events</h2>
          {rows === null ? (
            <p className="mt-3 text-sm text-charcoal/55">Loading…</p>
          ) : signedIn === false ? (
            <p className="mt-3 border border-dashed border-charcoal/25 p-6 text-center text-sm text-charcoal/60">
              <Link href="/my-events" className="font-medium text-pine underline">
                Sign in
              </Link>{' '}
              to see the events you are shooting.
            </p>
          ) : rows.length === 0 ? (
            <p className="mt-3 border border-dashed border-charcoal/25 p-6 text-center text-sm text-charcoal/60">
              No events yet. Use a pairing code above, or ask the host for one.
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
