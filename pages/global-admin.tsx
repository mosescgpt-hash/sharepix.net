import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import { isGlobalAdmin } from '@/lib/admin';
import {
  addEventPhotoCredits,
  createDiscountCode,
  deleteDiscountCode,
  deleteEventAsGlobalAdmin,
  getCurrentUserInfo,
  listAllEvents,
  listAllPhotos,
  listDiscountCodes,
  listPaymentsCount,
  manageUser,
  restoreEventAccess,
  setDiscountCodeActive,
  setEventUploadWindowEnd,
  startCheckout,
} from '@/lib/api';
import { CORPORATE_PLAN, PRICING_TIERS, getTier } from '@/lib/pricing';
import { eventLifecycle } from '@/lib/lifecycle';
import { DiscountCode, QREvent } from '@/lib/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Upload-window end date that lands an event in a chosen lifecycle phase (testing). */
function simulateWindowEnd(event: QREvent, phase: string): string | null {
  const now = Date.now();
  const isCorp = event.tier === 'corporate';
  const tier = getTier(event.tier);
  const lowRes = isCorp ? CORPORATE_PLAN.guestLowResDays : tier?.guestLowResDays ?? 30;
  const retention = isCorp ? CORPORATE_PLAN.retentionDays : tier?.retentionDays ?? 90;
  switch (phase) {
    case 'open':
      return new Date(now + 30 * DAY_MS).toISOString();
    case 'lowres':
      return new Date(now - 2 * DAY_MS).toISOString();
    case 'gone':
      return new Date(now - (lowRes + 2) * DAY_MS).toISOString();
    case 'archived':
      return new Date(now - (retention + 2) * DAY_MS).toISOString();
    default:
      return null;
  }
}

/** Short human label for where an event sits in its lifecycle. */
function lifecyclePhase(event: QREvent): { label: string; recover: boolean } {
  const lc = eventLifecycle(event);
  if (!lc.uploadWindowEndsAt) return { label: 'Active', recover: false };
  if (lc.uploadOpen) return { label: 'Open · uploads', recover: false };
  if (lc.hostAccess) {
    return {
      label: lc.guestResolution === 'small' ? 'Post-window · guests low-res' : 'Host retention',
      recover: false,
    };
  }
  return { label: lc.archived ? 'Archived · recoverable' : 'Past archive', recover: true };
}

function defaultExpiryValue(): string {
  const date = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function GlobalAdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [events, setEvents] = useState<QREvent[]>([]);
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [paymentsCount, setPaymentsCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userMessage, setUserMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [code, setCode] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [codeTier, setCodeTier] = useState('standard');
  const [expiresAt, setExpiresAt] = useState(defaultExpiryValue);
  const [maxUses, setMaxUses] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const admin = await isGlobalAdmin();
      setAuthorized(admin);
      if (!admin) return;

      const [eventItems, codeItems, photos] = await Promise.all([
        listAllEvents(),
        listDiscountCodes(),
        listAllPhotos(),
      ]);
      const counts = photos.reduce<Record<string, number>>((result, photo) => {
        result[photo.eventId] = (result[photo.eventId] ?? 0) + 1;
        return result;
      }, {});

      setEvents(
        eventItems.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
      );
      setCodes(codeItems.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)));
      setPhotoCounts(counts);

      // Payments count is best-effort: don't let a missing/empty Payment table
      // (e.g. before the webhook has ever fired) blank out the whole dashboard.
      try {
        setPaymentsCount(await listPaymentsCount());
      } catch {
        setPaymentsCount(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The global dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return events;
    return events.filter((event) =>
      [event.name, event.eventCode, event.createdBy, event.tier]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [events, search]);

  const totalPhotos = Object.values(photoCounts).reduce((sum, count) => sum + count, 0);
  const activeCodes = codes.filter(
    (item) => item.active && new Date(item.expiresAt).getTime() > Date.now() && item.usedCount < item.maxUses,
  ).length;

  function generateCode() {
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    setCode(`PILOT-${suffix}`);
  }

  async function handleCreateCode(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || !expiresAt || maxUses < 1) {
      setError('Enter a code, expiration date, and at least one use.');
      return;
    }
    setWorking('create-code');
    setError(null);
    try {
      const user = await getCurrentUserInfo();
      await createDiscountCode({
        code,
        assignedTo,
        tier: codeTier,
        expiresAt: new Date(expiresAt).toISOString(),
        maxUses,
        createdBy: user?.displayName,
      });
      setCode('');
      setAssignedTo('');
      setMaxUses(1);
      setExpiresAt(defaultExpiryValue());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be created.');
    } finally {
      setWorking(null);
    }
  }

  async function handleToggleCode(item: DiscountCode) {
    setWorking(`code-${item.code}`);
    setError(null);
    try {
      await setDiscountCodeActive(item.code, !item.active);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  async function handleDeleteCode(item: DiscountCode) {
    if (!window.confirm(`Remove discount code ${item.code}?`)) return;
    setWorking(`code-${item.code}`);
    setError(null);
    try {
      await deleteDiscountCode(item.code);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be removed.');
    } finally {
      setWorking(null);
    }
  }

  async function handleUserAction(action: 'resetPassword' | 'enable' | 'disable') {
    if (!userEmail.trim()) {
      setUserMessage({ text: 'Enter the account email first.', ok: false });
      return;
    }
    setWorking(`user-${action}`);
    setUserMessage(null);
    try {
      const message = await manageUser(userEmail, action);
      setUserMessage({ text: message, ok: true });
    } catch (err) {
      setUserMessage({
        text: err instanceof Error ? err.message : 'The action could not be completed.',
        ok: false,
      });
    } finally {
      setWorking(null);
    }
  }

  async function handleTestCheckout(tier: string) {
    setWorking(`checkout-${tier}`);
    setError(null);
    try {
      const url = await startCheckout(tier);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout could not be started.');
      setWorking(null);
    }
  }

  async function handleAddCredits(event: QREvent) {
    const input = window.prompt(
      `Add how many extra photos to “${event.name}”?\n\nPlan limit: ${event.photoLimit ?? 'unlimited'} · Current add-on: ${event.extraPhotoCredits ?? 0}\n\nUse a negative number to remove add-on capacity.`,
      '100',
    );
    if (input === null) return;
    const amount = parseInt(input, 10);
    if (!Number.isFinite(amount) || amount === 0) {
      setError('Enter a whole number of photos to add or remove.');
      return;
    }

    setWorking(`credits-${event.id}`);
    setError(null);
    try {
      await addEventPhotoCredits(event.id, amount);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo capacity could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  async function handleDeleteEvent(event: QREvent) {
    if (
      !window.confirm(
        `Permanently remove “${event.name}” and all of its photos? This cannot be undone.`,
      )
    ) return;

    setWorking(`event-${event.id}`);
    setError(null);
    try {
      await deleteEventAsGlobalAdmin(event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event could not be removed.');
    } finally {
      setWorking(null);
    }
  }

  async function handleSimulatePhase(event: QREvent, phase: string) {
    const iso = simulateWindowEnd(event, phase);
    if (!iso) return;
    setWorking(`sim-${event.id}`);
    setError(null);
    try {
      await setEventUploadWindowEnd(event.id, iso);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event window could not be updated.');
    } finally {
      setWorking(null);
    }
  }

  async function handleRestoreEvent(event: QREvent) {
    if (
      !window.confirm(
        `Restore host access to “${event.name}”? This resets the upload window to today, giving the host their full retention period again.`,
      )
    ) return;

    setWorking(`restore-${event.id}`);
    setError(null);
    try {
      await restoreEventAccess(event.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The event could not be restored.');
    } finally {
      setWorking(null);
    }
  }

  return (
    <Layout title="Global admin">
      <section className="py-8">
        {loading && authorized === null ? (
          <p className="text-center text-ink/60">Checking administrator access…</p>
        ) : authorized === false ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
            <h1 className="font-display text-2xl font-bold">Administrator access required</h1>
            <p className="mt-2 text-sm">This dashboard is restricted to sharepix.net global administrators.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-widest text-accent">Operations</p>
                <h1 className="font-display text-3xl font-extrabold">Global admin</h1>
                <p className="mt-1 text-ink/60">Monitor events and control complimentary pilot access.</p>
              </div>
              <button
                type="button"
                onClick={() => void load()}
                className="self-start rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-night"
              >
                Refresh dashboard
              </button>
            </div>

            {error ? (
              <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-ink/10 bg-white p-5">
                <p className="text-sm text-ink/60">Events</p>
                <p className="font-display text-3xl font-bold">{events.length}</p>
              </div>
              <div className="rounded-2xl border border-ink/10 bg-white p-5">
                <p className="text-sm text-ink/60">Stored photos</p>
                <p className="font-display text-3xl font-bold">{totalPhotos.toLocaleString()}</p>
              </div>
              <div className="rounded-2xl border border-ink/10 bg-white p-5">
                <p className="text-sm text-ink/60">Active pilot codes</p>
                <p className="font-display text-3xl font-bold">{activeCodes}</p>
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-dashed border-accent/40 bg-accent/5 p-5">
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-xl font-bold">Payments — test mode</h2>
                <p className="text-sm text-ink/70">
                  Run a real Stripe checkout with the test card <span className="font-mono">4242 4242 4242 4242</span>{' '}
                  (any future date / any CVC). No real money moves. Events stay free during the pilot — this only
                  confirms the payment flow works.
                </p>
                <p className="text-sm text-ink/70">
                  Payments recorded by the webhook:{' '}
                  <span className="font-display text-base font-bold text-ink">
                    {paymentsCount === null ? '—' : paymentsCount.toLocaleString()}
                  </span>
                </p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {PRICING_TIERS.map((tier) => (
                  <button
                    key={tier.id}
                    type="button"
                    disabled={working === `checkout-${tier.id}`}
                    onClick={() => void handleTestCheckout(tier.id)}
                    className="rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-night disabled:opacity-50"
                  >
                    {working === `checkout-${tier.id}` ? 'Starting…' : `Test ${tier.name} · $${tier.price}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-8 rounded-2xl border border-ink/10 bg-white p-5">
              <h2 className="font-display text-xl font-bold">User management</h2>
              <p className="text-sm text-ink/70">
                Reset a host&apos;s password (they get an email to set a new one — this also lets
                them back in if they&apos;re locked out), or enable/disable an account.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="min-w-0 flex-1 rounded-xl border border-ink/20 px-3 py-2.5 focus:border-accent focus:outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={working === 'user-resetPassword'}
                    onClick={() => void handleUserAction('resetPassword')}
                    className="rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-night disabled:opacity-50"
                  >
                    {working === 'user-resetPassword' ? 'Working…' : 'Reset password'}
                  </button>
                  <button
                    type="button"
                    disabled={working === 'user-enable'}
                    onClick={() => void handleUserAction('enable')}
                    className="rounded-full border border-ink/20 px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
                  >
                    {working === 'user-enable' ? 'Working…' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    disabled={working === 'user-disable'}
                    onClick={() => void handleUserAction('disable')}
                    className="rounded-full border border-red-200 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {working === 'user-disable' ? 'Working…' : 'Disable'}
                  </button>
                </div>
              </div>
              {userMessage ? (
                <p
                  className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                    userMessage.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {userMessage.text}
                </p>
              ) : null}
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
              <section>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-display text-2xl font-bold">Events</h2>
                    <p className="text-sm text-ink/60">Open a host dashboard or remove a problem event.</p>
                  </div>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search events"
                    className="rounded-xl border border-ink/20 bg-white px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="mt-4 space-y-3">
                  {filteredEvents.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-ink/20 bg-white p-8 text-center text-ink/60">
                      No events match this search.
                    </p>
                  ) : filteredEvents.map((event) => (
                    <article key={event.id} className="rounded-2xl border border-ink/10 bg-white p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate font-display text-lg font-bold">{event.name}</h3>
                          <p className="mt-1 text-sm text-ink/60">
                            {event.createdBy ?? 'Unknown host'} · {event.tier} · {photoCounts[event.id] ?? 0}
                            {event.photoLimit == null
                              ? ' photos (unlimited)'
                              : ` / ${event.photoLimit + (event.extraPhotoCredits ?? 0)} photos`}
                            {event.extraPhotoCredits ? ` (+${event.extraPhotoCredits} add-on)` : ''}
                          </p>
                          <p className="mt-1 text-xs text-ink/50">
                            Code {event.eventCode} · Created {event.createdAt ? new Date(event.createdAt).toLocaleDateString() : 'unknown'}
                          </p>
                          {(() => {
                            const phase = lifecyclePhase(event);
                            return (
                              <span
                                className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  phase.recover
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-ink/5 text-ink/60'
                                }`}
                              >
                                {phase.label}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Link href={`/event/${event.id}`} className="rounded-full border border-ink/20 px-3 py-1.5 hover:border-accent hover:text-accent">
                            Gallery
                          </Link>
                          <Link href={`/event/${event.id}/admin`} className="rounded-full border border-ink/20 px-3 py-1.5 hover:border-accent hover:text-accent">
                            Manage
                          </Link>
                          {event.photoLimit != null ? (
                            <button
                              type="button"
                              disabled={working === `credits-${event.id}`}
                              onClick={() => void handleAddCredits(event)}
                              className="rounded-full border border-ink/20 px-3 py-1.5 hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                              Add photos
                            </button>
                          ) : null}
                          {lifecyclePhase(event).recover ? (
                            <button
                              type="button"
                              disabled={working === `restore-${event.id}`}
                              onClick={() => void handleRestoreEvent(event)}
                              className="rounded-full border border-accent px-3 py-1.5 text-accent hover:bg-accent hover:text-white disabled:opacity-50"
                            >
                              Restore access
                            </button>
                          ) : null}
                          <select
                            aria-label="Simulate lifecycle phase (testing)"
                            disabled={working === `sim-${event.id}`}
                            value=""
                            onChange={(e) => {
                              const phase = e.target.value;
                              e.target.value = '';
                              if (phase) void handleSimulatePhase(event, phase);
                            }}
                            className="rounded-full border border-dashed border-ink/30 px-2 py-1.5 text-ink/60 disabled:opacity-50"
                          >
                            <option value="">Simulate…</option>
                            <option value="open">Open (uploads)</option>
                            <option value="lowres">Guests low-res</option>
                            <option value="gone">Guests gone</option>
                            <option value="archived">Archived</option>
                          </select>
                          <button
                            type="button"
                            disabled={working === `event-${event.id}`}
                            onClick={() => void handleDeleteEvent(event)}
                            className="rounded-full border border-red-200 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="font-display text-2xl font-bold">Pilot codes</h2>
                <p className="text-sm text-ink/60">Codes unlock the chosen plan. Default usage is one event.</p>

                <form onSubmit={handleCreateCode} className="mt-4 space-y-3 rounded-2xl border border-ink/10 bg-white p-4">
                  <div>
                    <label htmlFor="new-code" className="text-sm font-medium">Code</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        id="new-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        placeholder="PILOT-ALEX"
                        className="min-w-0 flex-1 rounded-xl border border-ink/20 px-3 py-2.5 uppercase focus:border-accent focus:outline-none"
                      />
                      <button type="button" onClick={generateCode} className="rounded-xl border border-ink/20 px-3 text-sm hover:border-accent hover:text-accent">
                        Generate
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="assigned-to" className="text-sm font-medium">Person or note</label>
                    <input
                      id="assigned-to"
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      placeholder="Alex's wedding test"
                      className="mt-1 w-full rounded-xl border border-ink/20 px-3 py-2.5 focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="code-tier" className="text-sm font-medium">Plan this code unlocks</label>
                    <select
                      id="code-tier"
                      value={codeTier}
                      onChange={(e) => setCodeTier(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink/20 bg-white px-3 py-2.5 focus:border-accent focus:outline-none"
                    >
                      {PRICING_TIERS.map((tier) => (
                        <option key={tier.id} value={tier.id}>
                          {tier.name} — ${tier.price}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-[1fr_100px] gap-3">
                    <div>
                      <label htmlFor="expires-at" className="text-sm font-medium">Expires</label>
                      <input
                        id="expires-at"
                        type="datetime-local"
                        value={expiresAt}
                        onChange={(e) => setExpiresAt(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-ink/20 px-3 py-2.5 text-sm focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="max-uses" className="text-sm font-medium">Uses</label>
                      <input
                        id="max-uses"
                        type="number"
                        min={1}
                        max={100}
                        value={maxUses}
                        onChange={(e) => setMaxUses(Number(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-ink/20 px-3 py-2.5 focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={working === 'create-code'}
                    className="w-full rounded-full bg-ink py-2.5 font-medium text-white hover:bg-night disabled:opacity-50"
                  >
                    {working === 'create-code'
                      ? 'Creating…'
                      : `Create ${getTier(codeTier)?.name ?? 'pilot'} pilot code`}
                  </button>
                </form>

                <div className="mt-4 space-y-3">
                  {codes.map((item) => {
                    const expired = new Date(item.expiresAt).getTime() <= Date.now();
                    const exhausted = item.usedCount >= item.maxUses;
                    const status = !item.active ? 'Inactive' : expired ? 'Expired' : exhausted ? 'Used' : 'Active';
                    return (
                      <article key={item.code} className="rounded-2xl border border-ink/10 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono font-bold text-ink">{item.code}</p>
                            <p className="mt-1 truncate text-xs text-ink/60">
                              {getTier(item.appliesToTier)?.name ?? item.appliesToTier} · {item.assignedTo || 'No note'}
                            </p>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'Active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                            {status}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-ink/60">
                          {item.usedCount}/{item.maxUses} uses · expires {new Date(item.expiresAt).toLocaleString()}
                        </p>
                        <div className="mt-3 flex gap-2 text-xs">
                          <button
                            type="button"
                            disabled={working === `code-${item.code}` || expired || exhausted}
                            onClick={() => void handleToggleCode(item)}
                            className="rounded-full border border-ink/20 px-3 py-1.5 hover:border-accent hover:text-accent disabled:opacity-40"
                          >
                            {item.active ? 'Expire now' : 'Reactivate'}
                          </button>
                          <button
                            type="button"
                            disabled={working === `code-${item.code}`}
                            onClick={() => void handleDeleteCode(item)}
                            className="rounded-full border border-red-200 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          </>
        )}
      </section>
    </Layout>
  );
}

export default withAuthenticator(GlobalAdminPage);
