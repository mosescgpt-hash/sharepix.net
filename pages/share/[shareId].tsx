import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import PhotoGrid from '@/components/PhotoGrid';
import { fetchDownloadShare, fetchEventPhotos } from '@/lib/api';
import { DisplayPhoto, DownloadShare } from '@/lib/types';
import { isGalleryActive } from '@/lib/validation';

export default function DownloadSharePage() {
  const router = useRouter();
  const shareId = typeof router.query.shareId === 'string' ? router.query.shareId : null;
  const [share, setShare] = useState<DownloadShare | null>(null);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const loadedShare = await fetchDownloadShare(shareId);
        if (!loadedShare || !isGalleryActive(loadedShare.expiresAt)) {
          if (!cancelled) setError('This download link is invalid or has expired.');
          return;
        }
        const allowedIds = new Set(loadedShare.photoIds);
        const eventPhotos = await fetchEventPhotos(loadedShare.eventId);
        if (!cancelled) {
          setShare(loadedShare);
          setPhotos(eventPhotos.filter((photo) => allowedIds.has(photo.id)));
        }
      } catch {
        if (!cancelled) setError('The shared event could not be loaded. Try again in a moment.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [shareId]);

  return (
    <Layout title={share ? `Download from ${share.eventName}` : 'Shared event downloads'}>
      <section className="py-8">
        {loading ? (
          <p className="text-center text-ink/60">Loading shared photos and videos…</p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">{error}</p>
        ) : share ? (
          <>
            <div className="text-center">
              <p className="text-sm font-semibold uppercase tracking-wide text-accent">Shared with you</p>
              <h1 className="mt-1 font-display text-3xl font-extrabold sm:text-4xl">{share.eventName}</h1>
              <p className="mt-2 text-ink/60">
                Download one item, select several, or download the entire shared collection.
              </p>
            </div>
            <div className="mt-8">
              <PhotoGrid
                photos={photos}
                canDownload
                eventName={share.eventName}
                emptyMessage="The host has not included any currently available media in this link."
              />
            </div>
          </>
        ) : null}
      </section>
    </Layout>
  );
}
