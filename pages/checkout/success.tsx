import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { fetchEvent } from '@/lib/api';
import { QREvent } from '@/lib/types';

type Phase = 'checking' | 'active' | 'pending' | 'generic';

export default function CheckoutSuccessPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  // No eventId → this was the admin test checkout; show the generic confirmation.
  const [phase, setPhase] = useState<Phase>('generic');
  const [event, setEvent] = useState<QREvent | null>(null);
  const attemptsRef = useRef(0);

  const poll = useCallback(async () => {
    if (!eventId) return;
    try {
      const ev = await fetchEvent(eventId);
      setEvent(ev);
      if (ev?.paid !== false) {
        // paid === true (activated) or missing (older/comped) → active.
        setPhase('active');
        return;
      }
    } catch {
      // ignore and keep polling; the webhook may not have landed yet
    }
    attemptsRef.current += 1;
    if (attemptsRef.current >= 8) {
      setPhase('pending'); // still not active after ~16s — reassure and let them refresh
    } else {
      window.setTimeout(() => void poll(), 2000);
    }
  }, [eventId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (eventId) {
      setPhase('checking');
      void poll();
    } else {
      setPhase('generic');
    }
  }, [router.isReady, eventId, poll]);

  return (
    <Layout title="Payment received">
      <section className="mx-auto max-w-lg py-16 text-center">
        <span className="text-5xl" aria-hidden>
          🎉
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold">Payment received</h1>

        {phase === 'checking' ? (
          <p className="mt-3 text-ink/70">
            Thanks! We&apos;re activating your event now — this usually takes just a few
            seconds…
          </p>
        ) : phase === 'active' ? (
          <>
            <p className="mt-3 text-ink/70">
              {event?.name ? <strong>{event.name}</strong> : 'Your event'} is live and ready
              to collect photos. Print your QR code and share it with your guests.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href={`/event/${eventId}/admin#event-qr-code`}
                className="rounded-full bg-accent px-6 py-3 font-medium text-white hover:bg-accent/90"
              >
                Get your QR code
              </Link>
              <Link
                href={`/event/${eventId}/admin`}
                className="rounded-full bg-ink px-6 py-3 font-medium text-white hover:bg-night"
              >
                Open dashboard
              </Link>
            </div>
          </>
        ) : phase === 'pending' ? (
          <>
            <p className="mt-3 text-ink/70">
              Your payment went through. Your event is finishing activation — this can take a
              moment. You can check again, or head to your events; it&apos;ll be ready shortly.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  attemptsRef.current = 0;
                  setPhase('checking');
                  void poll();
                }}
                className="rounded-full bg-ink px-6 py-3 font-medium text-white hover:bg-night"
              >
                Check again
              </button>
              <Link
                href="/my-events"
                className="rounded-full border border-ink/20 px-6 py-3 font-medium hover:border-accent"
              >
                My events
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-ink/70">Thanks! Your payment went through on Stripe.</p>
            <div className="mt-8 flex justify-center gap-3">
              <Link
                href="/my-events"
                className="rounded-full bg-ink px-6 py-3 font-medium text-white hover:bg-night"
              >
                My events
              </Link>
              <Link
                href="/"
                className="rounded-full border border-ink/20 px-6 py-3 font-medium hover:border-accent"
              >
                Home
              </Link>
            </div>
          </>
        )}
      </section>
    </Layout>
  );
}
