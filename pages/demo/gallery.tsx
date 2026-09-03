import Link from 'next/link';
import Layout from '@/components/Layout';
import PhotoGrid from '@/components/PhotoGrid';
import { DEMO_EVENT, DEMO_PHOTOS } from '@/lib/demoEvent';

/**
 * The sample gallery.
 *
 * Renders through the real PhotoGrid, so sorting, selection and the enlarged
 * view behave exactly as they do for a paying host — a hand-built imitation
 * would drift from the product and start misrepresenting it.
 *
 * Downloads and print ordering are off: there is nothing real behind these
 * tiles to download or print, and a button that fails is worse than no button.
 */
export default function DemoGalleryPage() {
  return (
    <Layout title="Sample gallery">
      <section className="py-8">
        <div className="rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <strong className="font-semibold">This is a sample.</strong> The images are
          illustrations, not photographs, and nothing here is a real event.{' '}
          <Link href="/demo" className="text-accent underline">
            See how it works
          </Link>{' '}
          or{' '}
          <Link href="/create-event" className="text-accent underline">
            create your own event
          </Link>
          .
        </div>

        <div className="mt-6">
          <h1 className="font-display text-3xl font-bold">{DEMO_EVENT.name}</h1>
          <p className="mt-1 text-ink/70">
            {DEMO_EVENT.location} · {DEMO_PHOTOS.length} photos from {' '}
            {new Set(DEMO_PHOTOS.map((p) => p.uploadedBy)).size} guests
          </p>
        </div>

        <div className="mt-6">
          <PhotoGrid
            photos={DEMO_PHOTOS}
            eventName={DEMO_EVENT.name}
            canDownload={false}
            canOrderPrints={false}
            downloadMessage="Downloads are turned off on the sample. On a real event, guests download full-resolution photos with no account — one at a time or the whole gallery as a ZIP."
          />
        </div>

        <div className="mt-10 sp-card p-6 text-center">
          <h2 className="font-display text-xl font-bold">Your gallery, with your photos</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-ink/70">
            Every angle of your day in one place, from everyone who was there. Set it up in
            about a minute.
          </p>
          <Link
            href="/create-event"
            className="mt-5 inline-block rounded-full bg-ink px-8 py-3 font-medium text-white hover:bg-night"
          >
            Create your event
          </Link>
        </div>
      </section>
    </Layout>
  );
}
