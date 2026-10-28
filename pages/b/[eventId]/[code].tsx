import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { openBoothGuestLink } from '@/lib/api';
import { boothLink } from '@/lib/boothLink';

/**
 * A guest's booth QR code is a link to this page (docs/booth-mode.md,
 * "One code"). Scanned once with the guest's own phone camera, it opens the
 * in-app photo session (live camera, unlimited photos until Stop), which has
 * a button to their private page. The photographer's camera reads the same
 * code to sort photos. A host's start/stop code opened this way gets a plain
 * explanation instead of a raw string.
 */
export default function BoothGuestLinkPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Opening the camera…');

  useEffect(() => {
    if (!router.isReady) return;
    const eventId = String(router.query.eventId ?? '');
    const code = String(router.query.code ?? '');
    if (!eventId || !code) return;
    let live = true;
    openBoothGuestLink(boothLink(eventId, code))
      .then((res) => {
        if (!live) return;
        if (res.ok && res.key) void router.replace(`/booth/capture/${encodeURIComponent(res.key)}`);
        else setMessage(res.message || 'This code isn’t valid for any event. Ask the host for a new one.');
      })
      .catch((err: unknown) => {
        if (live) setMessage(err instanceof Error ? err.message : 'Your page could not be opened.');
      });
    return () => {
      live = false;
    };
  }, [router, router.isReady, router.query.eventId, router.query.code]);

  return (
    <>
      <Head>
        <title>Take photos – SharePix</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-gray-700" role="status">{message}</p>
      </main>
    </>
  );
}
