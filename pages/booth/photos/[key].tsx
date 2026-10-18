import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { fetchBoothGallery, type BoothGalleryView } from '@/lib/api';

/**
 * One booth attendee's private gallery (docs/booth-mode.md, step 4), opened
 * from the link in their email. Only their photos, only ones the photographer
 * approved, each downloadable at full resolution.
 */
export default function BoothGalleryPage() {
  const router = useRouter();
  const key = typeof router.query.key === 'string' ? router.query.key : null;
  const [gallery, setGallery] = useState<BoothGalleryView | null | undefined>(undefined);
  const [zipping, setZipping] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    fetchBoothGallery(key)
      .then(setGallery)
      .catch(() => setGallery(null));
  }, [key]);

  const downloadable = gallery?.photos.filter((p) => p.downloadUrl) ?? [];

  async function downloadAll() {
    if (downloadable.length === 0) return;
    setZipping('Preparing your photos…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      let done = 0;
      for (const photo of downloadable) {
        const response = await fetch(photo.downloadUrl as string);
        if (!response.ok) throw new Error('download failed');
        const blob = await response.blob();
        const ext = blob.type === 'image/heic' ? 'heic' : blob.type === 'image/png' ? 'png' : 'jpg';
        zip.file(`photo-${String(done + 1).padStart(3, '0')}.${ext}`, blob);
        done += 1;
        setZipping(`Preparing your photos… ${done} of ${downloadable.length}`);
      }
      const archive = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(gallery?.eventName ?? 'photos').replace(/[^\w-]+/g, '-')}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setZipping(null);
    } catch {
      // A zip needs the files fetched by the page; if the browser refuses,
      // the individual Download buttons still work.
      setZipping('Download all did not work in this browser. Use the Download button on each photo.');
    }
  }

  return (
    <Layout title={gallery?.eventName ? `${gallery.eventName} · Your photos` : 'Your photos'} noindex>
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-5xl">
          {gallery === undefined ? (
            <p className="text-sm text-charcoal/55">Loading your photos&hellip;</p>
          ) : gallery === null ? (
            <Notice tone="error">Your photos could not be loaded. Try again in a moment.</Notice>
          ) : !gallery.ok ? (
            <>
              <h1 className="spx-display text-3xl">Gallery not found</h1>
              <p className="spx-body mt-3">{gallery.message}</p>
            </>
          ) : (
            <>
              <p className="spx-eyebrow">{gallery.eventName}</p>
              <h1 className="spx-display mt-2 text-3xl sm:text-4xl">
                {gallery.attendeeName ? `${gallery.attendeeName}, your photos` : 'Your photos'}
              </h1>
              {gallery.photos.length === 0 ? (
                <p className="spx-body mt-4">{gallery.message}</p>
              ) : (
                <>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-charcoal/65">
                      {gallery.photos.length} photo{gallery.photos.length === 1 ? '' : 's'}, full
                      resolution. Only you have this link.
                    </p>
                    {downloadable.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => void downloadAll()}
                        disabled={zipping !== null && zipping.startsWith('Preparing')}
                        className="spx-btn-ink disabled:opacity-50"
                      >
                        Download all
                      </button>
                    ) : null}
                  </div>
                  {zipping ? <p className="mt-2 text-sm text-charcoal/65">{zipping}</p> : null}
                  <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {gallery.photos.map((photo) => (
                      <li key={photo.id} className="border border-charcoal/15">
                        {photo.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo.previewUrl} alt="" className="aspect-[4/5] w-full bg-charcoal/5 object-cover" />
                        ) : (
                          <div className="aspect-[4/5] w-full bg-charcoal/5" />
                        )}
                        <div className="p-3">
                          {photo.downloadUrl ? (
                            <a href={photo.downloadUrl} className="spx-btn-ink block text-center">
                              Download
                            </a>
                          ) : (
                            <p className="text-xs text-charcoal/60">
                              Only a preview is available for this one.
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-6 text-xs text-charcoal/55">
                    Links on this page expire after an hour; reload it for fresh ones.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}
