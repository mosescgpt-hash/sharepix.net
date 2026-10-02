import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { fetchMFAPreference, signOut } from 'aws-amplify/auth';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { withHostAuth } from '@/components/hostAuth';
import { isGlobalAdmin } from '@/lib/admin';
import {
  SETTING_KEYS,
  clearContentReview,
  listAllEvents,
  listQuotaCounters,
  manageUser,
  readSetting,
  takeDownEvent,
} from '@/lib/api';
import {
  flaggedShare,
  flaggedSinceCleared,
  needsContentReview,
} from '@/lib/contentReview';
import {
  DEFAULT_FREE_EVENTS_PER_DAY,
  corporateMonthInUse,
  freeEventSeries,
  parseDailyLimit,
  type QuotaCounterRow,
} from '@/lib/quotaCounters';
import { getTier } from '@/lib/pricing';
import type { QREvent } from '@/lib/types';

/**
 * The admin portal: the few things worth doing from a phone, installable as
 * an app.
 *
 * ## Who gets in
 *
 * Signing in takes an email, a password and, for any account with an
 * authenticator app set up, a current six-digit code — Cognito asks for it
 * whenever MFA is enabled. Admin powers additionally REQUIRE that
 * authenticator: the admin-mfa-gate trigger issues tokens without the ADMINS
 * group to an admin who has not set one up. So reaching this page's content
 * means password + code, and the same is true of every admin-only API behind
 * it, which is where the protection actually lives.
 *
 * ## Unlisted, not secret
 *
 * The page is `noindex` in its markup and in an X-Robots-Tag header, appears
 * in no sitemap and no link, and is deliberately left out of robots.txt —
 * which is public, so listing it there would advertise it. The path is still
 * discoverable by anyone who reads the site's build files; that is fine,
 * because what it shows a stranger is a sign-in form.
 *
 * ## Installable on its own
 *
 * It points at its own manifest (/hq.webmanifest), scoped to this path, so
 * "Add to Home Screen" installs an "SP Admin" app that opens straight here
 * rather than a second copy of the public site.
 */
function AdminPortal() {
  const [state, setState] = useState<'checking' | 'admin' | 'no-mfa' | 'not-admin'>('checking');
  const [events, setEvents] = useState<QREvent[]>([]);
  const [quotas, setQuotas] = useState<QuotaCounterRow[]>([]);
  const [freeLimit, setFreeLimit] = useState<number>(DEFAULT_FREE_EVENTS_PER_DAY);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, rows, limit] = await Promise.all([
        listAllEvents(),
        listQuotaCounters().catch(() => [] as QuotaCounterRow[]),
        readSetting(SETTING_KEYS.freeEventsPerDay).catch(() => ''),
      ]);
      setEvents(all);
      setQuotas(rows);
      setFreeLimit(parseDailyLimit(limit) ?? DEFAULT_FREE_EVENTS_PER_DAY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      if (await isGlobalAdmin().catch(() => false)) {
        setState('admin');
        void load();
        return;
      }
      // Not carrying ADMINS. Either not an admin at all, or an admin whose
      // token was issued without it because no authenticator is set up.
      const mfa = await fetchMFAPreference().catch(() => null);
      setState(mfa?.enabled?.includes('TOTP') ? 'not-admin' : 'no-mfa');
    })();
  }, [load]);

  async function act(ev: QREvent, action: 'clear' | 'close' | 'suspend') {
    setNote(null);
    setError(null);
    if (action === 'clear' && !window.confirm(`Mark “${ev.name}” as reviewed and fine?`)) return;
    if (action === 'suspend' && !window.confirm(`Disable the account that owns “${ev.name}”?`)) return;
    let reason = '';
    let quiet = false;
    if (action === 'close') {
      const typed = window.prompt(`Close “${ev.name}”? Nothing is deleted.\n\nReason (kept on the event):`, '');
      if (typed === null) return;
      reason = typed;
      quiet = !window.confirm('Tell the host why?\n\nOK: they see that SharePix closed it.\nCancel: close quietly.');
    }
    setBusy(ev.id);
    try {
      if (action === 'clear') {
        await clearContentReview(ev.id, ev.flaggedCount ?? 0);
        setNote(`“${ev.name}” marked as reviewed.`);
      } else if (action === 'close') {
        setNote(await takeDownEvent(ev.id, reason, quiet));
      } else {
        setNote(await manageUser({ sub: (ev.owner ?? '').split('::')[0] }, 'disable'));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be done.');
    } finally {
      setBusy(null);
    }
  }

  const queue = events
    .filter((e) => needsContentReview(e))
    .sort((a, b) => flaggedSinceCleared(b) - flaggedSinceCleared(a));
  const closed = events.filter((e) => e.takenDownAt);
  const today = freeEventSeries(quotas, 1)[0];
  const todayLimit = today?.limit ?? freeLimit;
  const corporateThisMonth = quotas.filter((row) => corporateMonthInUse(row)).length;
  const recent = [...events]
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 8);

  return (
    <Layout title="Admin" noindex>
      <section className="mx-auto w-full max-w-xl px-4 py-6">
        <div className="flex items-center justify-between">
          <h1 className="font-sans text-2xl font-bold tracking-[-0.02em]">SharePix Admin</h1>
          <button
            type="button"
            onClick={() => void signOut().then(() => window.location.reload())}
            className="border border-charcoal/25 px-3 py-1.5 text-sm font-medium"
          >
            Sign out
          </button>
        </div>

        {state === 'checking' ? <p className="mt-6 text-sm text-charcoal/60">Checking access…</p> : null}

        {state === 'no-mfa' ? (
          <Notice tone="warn" className="mt-6">
            Admin access needs an authenticator app. Set one up on{' '}
            <Link href="/account-security" className="underline">
              Account security
            </Link>
            , then sign out and back in.
          </Notice>
        ) : null}

        {state === 'not-admin' ? (
          <Notice tone="error" className="mt-6">
            This account does not have admin access.
          </Notice>
        ) : null}

        {state === 'admin' ? (
          <>
            {error ? (
              <Notice tone="error" className="mt-4">
                {error}
              </Notice>
            ) : null}
            {note ? (
              <Notice tone="success" className="mt-4">
                {note}
              </Notice>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Tile label="Needs review" value={loading ? '…' : String(queue.length)} warn={queue.length > 0} />
              <Tile label="Closed events" value={loading ? '…' : String(closed.length)} />
              <Tile
                label="Free events today"
                value={loading ? '…' : `${today?.given ?? 0} / ${todayLimit}`}
                warn={(today?.refused ?? 0) > 0}
              />
              <Tile label="Corporate active this month" value={loading ? '…' : String(corporateThisMonth)} />
            </div>

            <h2 className="mt-8 font-sans text-lg font-bold">Content review</h2>
            {queue.length === 0 ? (
              <p className="mt-2 text-sm text-charcoal/60">Nothing over the threshold.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {queue.map((ev) => (
                  <li key={ev.id} className="spx-card p-4">
                    <p className="font-medium">{ev.name}</p>
                    <p className="text-xs text-charcoal/65">
                      {ev.createdBy ?? 'Host'} · {ev.flaggedCount ?? 0} flagged of {ev.photoCount ?? 0} (
                      {Math.round(flaggedShare(ev) * 100)}%)
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <ActionButton disabled={busy === ev.id} onClick={() => void act(ev, 'clear')}>
                        Fine
                      </ActionButton>
                      <ActionButton danger disabled={busy === ev.id} onClick={() => void act(ev, 'close')}>
                        Close
                      </ActionButton>
                      <ActionButton danger disabled={busy === ev.id} onClick={() => void act(ev, 'suspend')}>
                        Disable
                      </ActionButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h2 className="mt-8 font-sans text-lg font-bold">Newest events</h2>
            <ul className="mt-2 divide-y divide-charcoal/10 border-y border-charcoal/10">
              {recent.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{ev.name}</span>
                  <span className="shrink-0 text-xs text-charcoal/60">
                    {ev.tier === 'corporate' ? 'Corporate' : getTier(ev.tier ?? '')?.name ?? ev.tier}
                    {ev.paid === false ? ' · unpaid' : ''}
                    {ev.takenDownAt ? ' · closed' : ''}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void load()}
                className="border border-charcoal/25 px-4 py-2 text-sm font-medium"
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <Link href="/global-admin" className="bg-ink px-4 py-2 text-sm font-medium text-canvas">
                Full dashboard
              </Link>
            </div>
          </>
        ) : null}
      </section>
    </Layout>
  );
}

function Tile({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`spx-card p-4 ${warn ? 'border-amber-400' : ''}`}>
      <p className="text-xs text-charcoal/60">{label}</p>
      <p className="mt-1 font-sans text-2xl font-bold tracking-[-0.02em]">{value}</p>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger = false,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`border py-2.5 text-sm font-medium disabled:opacity-50 ${
        danger ? 'border-red-300 text-red-800' : 'border-charcoal/25 text-charcoal'
      }`}
    >
      {children}
    </button>
  );
}

const GatedPortal = withHostAuth(AdminPortal, {
  purpose: 'Sign in to SharePix Admin.',
  arriving: 'returning',
});

/**
 * The head tags sit OUTSIDE the sign-in wrapper. Signed out, the wrapper
 * renders only the sign-in form, so tags inside AdminPortal would be missing
 * exactly when a crawler or a first-time "Add to Home Screen" sees the page.
 */
export default function AdminPortalPage() {
  return (
    <>
      <Head>
        <title>Admin</title>
        <meta key="robots" name="robots" content="noindex, nofollow, noarchive" />
        {/* Its own install identity, scoped to this path. `key` replaces the
            site-wide manifest link from _app rather than adding a second. */}
        <link key="manifest" rel="manifest" href="/hq.webmanifest" />
        <meta key="apple-title" name="apple-mobile-web-app-title" content="SP Admin" />
      </Head>
      <GatedPortal />
    </>
  );
}
