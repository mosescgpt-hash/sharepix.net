import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Head from 'next/head';
import type QRCodeStyling from 'qr-code-styling';
import { withAuthenticator } from '@aws-amplify/ui-react';
import { fetchEvent, getCurrentUserInfo } from '@/lib/api';
import { isGlobalAdmin } from '@/lib/admin';
import { QREvent } from '@/lib/types';

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function EventBrochurePage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const qrContainerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const [ev, user, admin] = await Promise.all([
        fetchEvent(eventId),
        getCurrentUserInfo(),
        isGlobalAdmin().catch(() => false),
      ]);
      if (!ev) {
        setError('We couldn’t find that event.');
        return;
      }
      const isOwner = !!user && !!ev.owner && ev.owner.includes(user.userId);
      if (!isOwner && !admin) {
        setDenied(true);
        return;
      }
      setEvent(ev);
    } catch {
      setError('Something went wrong loading the brochure. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!eventId) return;
    setUploadUrl(`${window.location.origin}/event/${eventId}/upload`);
  }, [eventId]);

  // Render a crisp, high-error-correction QR that points at the guest upload page.
  useEffect(() => {
    if (!uploadUrl || !event || !qrContainerRef.current) return;
    let active = true;
    let qrCode: QRCodeStyling | null = null;
    import('qr-code-styling').then(({ default: QRCodeStylingConstructor }) => {
      if (!active || !qrContainerRef.current) return;
      qrCode = new QRCodeStylingConstructor({
        width: 320,
        height: 320,
        type: 'canvas',
        data: uploadUrl,
        margin: 8,
        qrOptions: { errorCorrectionLevel: 'H' },
        dotsOptions: { type: 'square', color: '#123851' },
        cornersSquareOptions: { type: 'square', color: '#123851' },
        cornersDotOptions: { type: 'square', color: '#123851' },
        backgroundOptions: { color: '#ffffff' },
      });
      qrContainerRef.current.replaceChildren();
      qrCode.append(qrContainerRef.current);
    });
    return () => {
      active = false;
    };
  }, [uploadUrl, event]);

  return (
    <div className="min-h-screen bg-smoke font-body text-ink">
      <Head>
        <title>{event ? `${event.name} — brochure` : 'Event brochure'} — sharepix.net</title>
      </Head>

      {/* Toolbar — hidden when printing */}
      <div className="print:hidden border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            href={eventId ? `/event/${eventId}/admin` : '/my-events'}
            className="text-sm font-medium text-ink/70 hover:text-accent"
          >
            ← Back to dashboard
          </Link>
          {event ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent/90"
            >
              Print / Save as PDF
            </button>
          ) : null}
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <p className="text-center text-muted">Loading brochure…</p>
        ) : denied ? (
          <p className="mx-auto max-w-lg rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
            Only the event host or a sharepix.net global administrator can open this brochure.
          </p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">
            {error}
          </p>
        ) : event ? (
          <>
            <p className="print:hidden mb-4 text-center text-sm text-muted">
              Print this and place it on tables, or share it digitally. Guests scan the
              code to add their photos — no app or account needed.
            </p>

            {/* The printable flyer */}
            <article className="mx-auto flex max-w-xl flex-col items-center rounded-3xl border border-ink/10 bg-white px-8 py-12 text-center shadow-sm print:border-0 print:shadow-none">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                Share your photos
              </p>
              <h1 className="mt-3 font-display text-4xl font-extrabold leading-tight">
                {event.name}
              </h1>
              {formatDate(event.date) ? (
                <p className="mt-2 text-lg text-muted">{formatDate(event.date)}</p>
              ) : null}

              <div className="my-8 rounded-2xl border border-ink/10 bg-white p-4">
                <div ref={qrContainerRef} className="h-[320px] w-[320px]" aria-label="Upload QR code" />
              </div>

              <p className="font-display text-2xl font-bold">Scan to add your photos</p>
              <p className="mt-2 max-w-sm text-muted">
                Point your phone&apos;s camera at the code, tap the link, and upload the
                pictures and videos you took. Everyone&apos;s memories, all in one gallery.
              </p>

              <div className="mt-6 rounded-xl bg-smoke px-5 py-3">
                <p className="text-xs uppercase tracking-wide text-muted">Or visit</p>
                <p className="break-all font-mono text-sm text-ink">{uploadUrl}</p>
                <p className="mt-1 text-xs text-muted">
                  Event code: <span className="font-semibold text-ink">{event.eventCode}</span>
                </p>
              </div>

              <p className="mt-8 text-sm text-muted">
                Powered by <span className="font-semibold">sharepix.net</span>
              </p>
            </article>
          </>
        ) : null}
      </main>
    </div>
  );
}

// Requires sign-in; the owner/admin check above limits it to the event's host.
export default withAuthenticator(EventBrochurePage);
