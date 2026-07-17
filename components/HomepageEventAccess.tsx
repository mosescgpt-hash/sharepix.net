import { useEffect, useState } from 'react';
import Link from 'next/link';
import InstallAppButton from '@/components/InstallAppButton';
import { getCurrentUserInfo, listMyEvents } from '@/lib/api';
import { QREvent } from '@/lib/types';

type HostState = 'loading' | 'signed-out' | 'signed-in';

export default function HomepageEventAccess() {
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

  return (
    <section className="mx-auto max-w-3xl py-10" aria-label="Host event access">
      <div className="rounded-2xl border border-ink/10 bg-ink p-6 text-white shadow-sm sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-mint">Event hosts</p>
        {hostState === 'loading' ? (
          <div className="mt-3 space-y-3" aria-label="Checking host account">
            <div className="h-7 w-40 animate-pulse rounded bg-white/15" />
            <div className="h-12 animate-pulse rounded-xl bg-white/10" />
          </div>
        ) : hostState === 'signed-out' ? (
          <>
            <h2 id="host-access-heading" className="mt-1 font-display text-2xl font-bold">Already created an event?</h2>
            <p className="mt-2 text-sm text-white/75">
              Sign in to open your events, manage uploads, and get your event QR code anytime.
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
              <h2 id="host-access-heading" className="font-display text-2xl font-bold">Your events</h2>
              <Link href="/my-events" className="text-sm font-medium text-mint hover:underline">
                View all
              </Link>
            </div>
            {events.length ? (
              <div className="mt-4 space-y-2">
                {events.map((event) => (
                  <div key={event.id} className="flex flex-col gap-3 rounded-xl bg-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 truncate font-medium">{event.name}</span>
                    <div className="flex shrink-0 gap-2 text-sm">
                      <Link href={`/event/${event.id}/admin`} className="rounded-full border border-white/20 px-3 py-1.5 hover:border-mint hover:text-mint">
                        Manage
                      </Link>
                      <Link href={`/event/${event.id}/admin#event-qr-code`} className="rounded-full bg-mint px-3 py-1.5 font-semibold text-ink hover:bg-white">
                        QR code
                      </Link>
                    </div>
                  </div>
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
