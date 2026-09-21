import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { fetchMyProConnections, getCurrentUserInfo } from '@/lib/api';
import {
  PRO_STEPS,
  connectionState,
  eventLabel,
  liveState,
} from '@/lib/proStatus';

/**
 * A photographer's events.
 *
 * ## What this page was, and what it is for
 *
 * It opened with a headline selling the feature to somebody who had already
 * signed up for it, and then listed events as raw UUIDs with a link reading
 * "Review · paused". A photographer arriving between two jobs could not tell
 * which wedding was which, and "paused" named a state without saying that it
 * meant the couple had seen nothing.
 *
 * So: the events come first and carry their names, every state says what it
 * costs in the same words the review page uses, and the explanation of how the
 * feature works is three lines rather than a paragraph — shown when it is
 * useful, which is before there is anything in the list.
 *
 * Signed out and "no events yet" stay separate answers. They produced the same
 * empty list once, and a photographer who simply was not logged in was told a
 * host had not added them.
 */
export default function ProHomePage() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchMyProConnections>> | null>(null);
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

  const hasEvents = rows !== null && rows.length > 0;

  return (
    <Layout title="SharePix Pro">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-2xl">
          <p className="spx-eyebrow">SharePix Pro</p>
          <h1 className="mt-3">
            <span className="spx-display block">Your shots,</span>
            <span className="spx-display-serif block">in their gallery.</span>
          </h1>

          {/* The events, first, because that is what a signed-in photographer
              came for. The explanation sits underneath and only expands itself
              when the list is empty. */}
          <h2 className="mt-8 font-sans text-sm font-semibold uppercase tracking-[0.14em] text-charcoal/55">
            Your events
          </h2>

          {rows === null ? (
            <p className="mt-3 text-sm text-charcoal/55">Loading&hellip;</p>
          ) : signedIn === false ? (
            <p className="mt-3 border border-dashed border-charcoal/25 p-6 text-center text-sm text-charcoal/60">
              <Link href="/my-events" className="font-medium text-pine underline">
                Sign in
              </Link>{' '}
              to see the events you are shooting.
            </p>
          ) : rows.length === 0 ? (
            <p className="mt-3 border border-dashed border-charcoal/25 p-6 text-center text-sm text-charcoal/60">
              Nothing yet. A host adds you with a pairing code &mdash; there is one below.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-charcoal/10 border-y border-charcoal/10">
              {rows.map((row) => {
                const accepted = row.status === 'accepted';
                const state = liveState(row.livePublishing);
                const waiting = connectionState(row.status);
                return (
                  <li key={row.eventId} className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{eventLabel(row.eventName)}</p>
                        {row.eventDate ? (
                          <p className="mt-0.5 text-xs text-charcoal/55">{row.eventDate}</p>
                        ) : null}
                      </div>
                      {accepted ? (
                        <span
                          className={`shrink-0 px-2 py-1 text-xs font-medium ${
                            row.livePublishing
                              ? 'bg-pine text-white'
                              : 'bg-charcoal/10 text-charcoal/70'
                          }`}
                        >
                          {state.badge}
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-charcoal/55">{waiting.label}</span>
                      )}
                    </div>

                    {/* The sentence that was missing. "Paused" on its own does
                        not tell somebody the couple has seen nothing. */}
                    <p className="mt-1 text-sm text-charcoal/65">
                      {accepted ? state.meaning : waiting.detail}
                    </p>

                    {accepted ? (
                      <Link
                        href={`/pro/events/${row.eventId}/review`}
                        className="mt-2 inline-block text-sm font-medium text-pine underline"
                      >
                        Open review
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Below the list, because somebody with events already knows. */}
          <div className="mt-10 border border-ink/15 bg-sage/25 p-5">
            <p className="spx-body font-medium">Got a pairing code?</p>
            <p className="mt-1 text-sm text-charcoal/70">
              The host generates one from their event dashboard. It works once and expires
              quickly.
            </p>
            <Link href="/pro/join" className="spx-btn-ink mt-4">
              Join an event
            </Link>
          </div>

          {/* Three lines, and only prominent when the list is empty — which is
              exactly when somebody does not yet know how this works. */}
          <div className={hasEvents ? 'mt-10 opacity-75' : 'mt-10'}>
            <h2 className="font-sans text-sm font-semibold uppercase tracking-[0.14em] text-charcoal/55">
              How it works
            </h2>
            <ol className="mt-3 divide-y divide-charcoal/10 border-y border-charcoal/10">
              {PRO_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4 py-3">
                  <span className="spx-numeral shrink-0 text-sm text-charcoal/40">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-sm">
                    <span className="font-medium">{step.title}</span>
                    <span className="mt-0.5 block text-charcoal/65">{step.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-charcoal/55">
              Your originals stay yours. We make the preview and delete the original unless
              you ask us to keep it &mdash; that switch is on the review page.
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
