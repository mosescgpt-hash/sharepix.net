import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import UploadForm from '@/components/UploadForm';
import { fetchEvent } from '@/lib/api';
import { isGalleryActive } from '@/lib/validation';
import { QREvent } from '@/lib/types';

export default function GuestUploadPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    fetchEvent(eventId)
      .then((ev) => {
        if (cancelled) return;
        if (!ev) {
          setError('We couldn\u2019t find that event. Double-check the QR code or link.');
        } else {
          setEvent(ev);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Something went wrong loading the event. Try again in a moment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const active = isGalleryActive(event?.accessExpiresAt);

  return (
    <Layout title={event ? `Upload to ${event.name}` : 'Upload photos and videos'}>
      <section className="mx-auto max-w-lg py-8">
        {loading ? (
          <p className="text-center text-ink/60">Loading event…</p>
        ) : error ? (
          <p className="rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">{error}</p>
        ) : event ? (
          <>
            <p className="text-center text-sm uppercase tracking-wide text-ink/50">
              You&apos;re adding photos and videos to
            </p>
            <h1 className="mt-1 text-center font-display text-3xl font-extrabold">
              {event.name}
            </h1>
            {event.date ? (
              <p className="mt-1 text-center text-ink/60">
                {new Date(`${event.date}T00:00:00`).toLocaleDateString()}
              </p>
            ) : null}

            <div className="mt-8">
              {active ? (
                <UploadForm eventId={event.id} />
              ) : (
                <p className="rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
                  This event&apos;s upload window has closed.
                </p>
              )}
            </div>

            <p className="mt-6 text-center text-sm">
              <Link href={`/event/${event.id}`} className="text-accent underline">
                View the event gallery →
              </Link>
            </p>
          </>
        ) : null}
      </section>
    </Layout>
  );
}
