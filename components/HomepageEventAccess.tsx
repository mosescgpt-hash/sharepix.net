import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import InstallAppButton from '@/components/InstallAppButton';
import { findEventByCode, getCurrentUserInfo, listMyEvents } from '@/lib/api';
import { QREvent } from '@/lib/types';

type HostState = 'loading' | 'signed-out' | 'signed-in';

export default function HomepageEventAccess() {
  const router = useRouter();
  const [eventCode, setEventCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [hostState, setHostState] = useState<HostState>('loading');
  const [events, setEvents] = useState<QREvent[]>([]);

  useEffect(() => {
    let active = true;
    getCurrentUserInfo()
      .then(async (user) => {
        if (!active) return;
        if (!user) {
          setHostState('signed-out');
          return;
        }
        const ownedEvents = await listMyEvents();
        if (!active) return;
        setEvents(ownedEvents.slice(0, 3));
        setHostState('signed-in');
      })
      .catch(() => {
        if (active) setHostState('signed-out');
      });
    return () => {
      active = false;
    };
  }, []);

  async function openEvent(e: FormEvent) {
    e.preventDefault();
    if (!eventCode.trim()) {
      setCodeError('Enter the event code first.');
      return;
    }

    setCodeBusy(true);
    setCodeError(null);
    try {
      const event = await findEventByCode(eventCode);
      if (!event) {
        setCodeError('We could not find that event code. Check it and try again.');
        return;
      }
      await router.push(`/event/${event.id}`);
    } catch {
      setCodeError('We could not check that code right now. Please try again.');
    } finally {
      setCodeBusy(false);
    }
  }

  return (
    <section className="grid gap-5 py-10 lg:grid-cols-2" aria-labelledby="event-access-heading">
      <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-accent">Guest access</p>
        <h2 id="event-access-heading" className="mt-1 font-display text-2xl font-bold">
          Enter an event
        </h2>
        <p className="mt-2 text-sm text-ink/65">
          Scan the event QR code or type the short event code supplied by the host.
        </p>
        <form onSubmit={openEvent} className="mt-5 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="homepage-event-code" className="sr-only">Event code</label>
          <input
            id="homepage-event-code"
            value={eventCode}
            onChange={(e) => {
              setEventCode(e.target.value.toUpperCase());
              setCodeError(null);
            }}
            placeholder="Enter event code"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={12}
            className="min-w-0 flex-1 rounded-xl border border-ink/20 px-4 py-3 uppercase tracking-widest focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={codeBusy}
            className="rounded-xl bg-accent px-5 py-3 font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {codeBusy ? 'Opening…' : 'Open event'}
          </button>
        </form>
        {codeError ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {codeError}
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-ink/10 bg-ink p-6 text-white shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-mint">Event hosts</p>
        {hostState === 'loading' ? (
          <div className="mt-3 space-y-3" aria-label="Checking host account">
            <div className="h-7 w-40 animate-pulse rounded bg-white/15" />
            <div className="h-12 animate-pulse rounded-xl bg-white/10" />
          </div>
        ) : hostState === 'signed-out' ? (
          <>
            <h2 className="mt-1 font-display text-2xl font-bold">Already created an event?</h2>
            <p className="mt-2 text-sm text-white/75">
              Sign in to open your events, manage uploads, download media, and edit QR codes.
            </p>
            <Link
              href="/my-events"
              className="mt-5 inline-block rounded-full bg-white px-6 py-3 font-medium text-ink hover:bg-mint"
            >
              Host sign in
            </Link>
          </>
        ) : (
          <>
            <div className="mt-1 flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-bold">Your events</h2>
              <Link href="/my-events" className="text-sm font-medium text-mint hover:underline">
                View all
              </Link>
            </div>
            {events.length ? (
              <div className="mt-4 space-y-2">
                {events.map((event) => (
                  <Link
                    key={event.id}
                    href={`/event/${event.id}/admin`}
                    className="flex items-center justify-between gap-3 rounded-xl bg-white/10 px-4 py-3 hover:bg-white/15"
                  >
                    <span className="min-w-0 truncate font-medium">{event.name}</span>
                    <span className="shrink-0 text-sm text-mint">Open →</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/75">Your account does not have an event yet.</p>
            )}
            <Link
              href="/create-event"
              className="mt-4 inline-block rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ink hover:bg-mint"
            >
              Create another event
            </Link>
          </>
        )}
        <div className="mt-5 text-sm text-white/75 [&_button]:text-mint">
          <InstallAppButton />
        </div>
      </div>
    </section>
  );
}
