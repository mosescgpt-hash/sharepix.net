import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { openBoothGuestLink } from '@/lib/api';
import { boothLink } from '@/lib/boothLink';

/**
 * A guest's booth QR code is a link to this page (docs/booth-mode.md,
 * "One code"). Scanned with the guest's own camera, it opens their private
 * page. The photographer's camera reads the same code to sort photos.
 */
export default function BoothGuestLinkPage() {
  const router = useRouter();
  const [message, setMessage] = useState('Opening your page…');

  useEffect(() => {
    if (!router.isReady) return;
    const eventId = String(router.query.eventId ?? '');
    const code = String(router.query.code ?? '');
    if (!eventId || !code) return;
    let live = true;
    openBoothGuestLink(boothLink(eventId, code))
      .then((res) => {
        if (!live) return;
        if (res.ok && res.key) void router.replace(`/booth/photos/${encodeURIComponent(res.key)}`);
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
        <title>Your photos – SharePix</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-gray-700" role="status">{message}</p>
      </main>
    </>
  );
}
