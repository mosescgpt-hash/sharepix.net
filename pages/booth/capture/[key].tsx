import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import BoothCapture from '@/components/BoothCapture';
import { fetchBoothGallery, type BoothGalleryView } from '@/lib/api';

/**
 * A booth guest's photo session (docs/booth-mode.md, "Take photos in the
 * app"). Reached by scanning their own booth code with their phone camera
 * (/b/<eventId>/<code> sends them here). The key is the same private key as
 * their photo page, so everything they take lands on that page.
 */
export default function BoothCapturePage() {
  const router = useRouter();
  const key = typeof router.query.key === 'string' ? router.query.key : null;
  const [view, setView] = useState<BoothGalleryView | null | undefined>(undefined);

  useEffect(() => {
    if (!key) return;
    fetchBoothGallery(key)
      .then(setView)
      .catch(() => setView(null));
  }, [key]);

  return (
    <>
      <Head>
        <title>Take photos – SharePix</title>
        <meta name="robots" content="noindex" />
      </Head>
      {view === undefined ? (
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-gray-700" role="status">Opening the camera&hellip;</p>
        </main>
      ) : view === null ? (
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-gray-700" role="alert">This page could not be loaded. Try again in a moment.</p>
        </main>
      ) : !view.ok || !key ? (
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-gray-700" role="alert">{view.message || 'This link is not valid.'}</p>
        </main>
      ) : (
        <BoothCapture
          galleryKey={key}
          eventName={view.eventName}
          attendeeName={view.attendeeName}
          uploadsOpen={view.uploadsOpen}
          uploadsMessage={view.uploadsMessage}
          sharedGalleryPath={view.sharedGalleryPath}
          sharedGalleryMessage={view.sharedGalleryMessage}
          emailHint={view.emailHint}
          emailsStopped={view.emailsStopped}
        />
      )}
    </>
  );
}
