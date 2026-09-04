import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
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
    <Layout title="Sample gallery" width="bleed">
      <section className="spx-section-ink py-10 sm:py-14">
        <div className="spx-inner">
          <p className="spx-eyebrow">
            {DEMO_PHOTOS.length} photos from{' '}
            {new Set(DEMO_PHOTOS.map((photo) => photo.uploadedBy)).size} guests
          </p>
          <h1 className="spx-display mt-3">{DEMO_EVENT.name}</h1>
          <p className="spx-display-serif mt-1 text-2xl sm:text-3xl">{DEMO_EVENT.location}</p>
        </div>
      </section>

      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="spx-inner">
        <Notice label="This is a sample">
          The images are illustrations, not photographs, and nothing here is a real event.{' '}
          <Link href="/demo" className="text-pine underline">
            See how it works
          </Link>{' '}
          or{' '}
          <Link href="/create-event" className="text-pine underline">
            create your own event
          </Link>
          .
        </Notice>

        <div className="mt-8">
          <PhotoGrid
            photos={DEMO_PHOTOS}
            eventName={DEMO_EVENT.name}
            canDownload={false}
            canOrderPrints={false}
            downloadMessage="Downloads are turned off on the sample. On a real event, guests download full-resolution photos with no account — one at a time or the whole gallery as a ZIP."
          />
        </div>

        <div className="spx-card mt-12 p-7">
          <p className="spx-eyebrow">Your turn</p>
          <h2 className="mt-2">
            <span className="spx-display block text-3xl sm:text-4xl">Your gallery,</span>
            <span className="spx-display-serif block text-3xl sm:text-4xl">with your photos.</span>
          </h2>
          <p className="spx-body mt-3 max-w-lg text-sm">
            Every angle of your day in one place, from everyone who was there. Set it up in about
            a minute.
          </p>
          <Link href="/create-event" className="spx-btn-ink mt-6">
            Create your event
          </Link>
        </div>
        </div>
      </section>
    </Layout>
  );
}
