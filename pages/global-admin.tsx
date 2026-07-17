import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import { isGlobalAdmin } from '@/lib/admin';
import {
  createDiscountCode,
  deleteDiscountCode,
  deleteEventAsGlobalAdmin,
  getCurrentUserInfo,
  listAllEvents,
  listAllPhotos,
  listDiscountCodes,
  setDiscountCodeActive,
} from '@/lib/api';
import { DiscountCode, QREvent } from '@/lib/types';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [code, setCode] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
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
                            {event.createdBy ?? 'Unknown host'} · {event.tier} · {photoCounts[event.id] ?? 0} photos
                          </p>
                          <p className="mt-1 text-xs text-ink/50">
                            Code {event.eventCode} · Created {event.createdAt ? new Date(event.createdAt).toLocaleDateString() : 'unknown'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Link href={`/event/${event.id}`} className="rounded-full border border-ink/20 px-3 py-1.5 hover:border-accent hover:text-accent">
                            Gallery
                          </Link>
                          <Link href={`/event/${event.id}/admin`} className="rounded-full border border-ink/20 px-3 py-1.5 hover:border-accent hover:text-accent">
                            Manage
                          </Link>
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
                <p className="text-sm text-ink/60">Codes unlock Standard only. Default usage is one event.</p>

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
                    {working === 'create-code' ? 'Creating…' : 'Create Standard pilot code'}
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
                            <p className="mt-1 truncate text-xs text-ink/60">{item.assignedTo || 'No note'}</p>
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
