import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import PhotoGrid from '@/components/PhotoGrid';
import { DEMO_GALLERIES, demoGallery } from '@/lib/demoEvent';

/**
 * The sample gallery, for three different occasions.
 *
 * Renders through the real PhotoGrid, so sorting, selection and the enlarged
 * view behave exactly as they do for a paying host — a hand-built imitation
 * would drift from the product and start misrepresenting it.
 *
 * ## Why three, and why they switch on one page
 *
 * A prospect running a trade stand should not have to imagine their event from
 * a wedding. Three galleries answer that, and they sit on one URL because the
 * comparison is the argument: the same product, the same grid, three occasions
 * that look nothing like each other.
 *
 * Which one is showing lives in `?event=`, so a specific gallery is still
 * linkable and the back button still works. Switching is a shallow route change
 * — no fetch, no reload, and no data to load, because all three are already in
 * the bundle as a list of paths.
 *
 * Downloads and print ordering are off: there is nothing real behind these
 * tiles to download or print, and a button that fails is worse than no button.
 */
export default function DemoGalleryPage() {
  const router = useRouter();
  // Falls back to the wedding for anything unrecognised, including the array
  // Next gives for a repeated query parameter.
  const active = demoGallery(router.query.event);

  return (
    <Layout title="Sample gallery" width="bleed">
      <section className="spx-section-ink py-10 sm:py-14">
        <div className="spx-inner">
          <p className="spx-eyebrow">
            {active.photos.length} photos from {active.contributors} guests
          </p>
          <h1 className="spx-display mt-3">{active.event.name}</h1>
          <p className="spx-display-serif mt-1 text-2xl sm:text-3xl">{active.event.location}</p>
        </div>
      </section>

      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="spx-inner">
          <nav aria-label="Choose a sample event" className="flex flex-wrap gap-2">
            {DEMO_GALLERIES.map((gallery) => {
              const current = gallery.key === active.key;
              return (
                <Link
                  key={gallery.key}
                  // Shallow: the page has no getStaticProps to re-run, and a
                  // full navigation would scroll and flash for a change that is
                  // already entirely in memory.
                  href={{ query: { event: gallery.key } }}
                  shallow
                  scroll={false}
                  aria-current={current ? 'page' : undefined}
                  className={`border px-4 py-2 text-sm font-medium transition ${
                    current
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                  }`}
                >
                  {gallery.label}
                </Link>
              );
            })}
          </nav>
          <p className="mt-3 text-sm text-charcoal/70">{active.blurb}</p>

          <Notice label="This is a sample" className="mt-6">
            {/* Which of the two it is depends on whether this event's folder
                has files in it, so the sentence is chosen rather than written.
                A standing claim that these are illustrations would quietly
                become untrue the first time somebody dropped a photograph in. */}
            {active.isPhotography
              ? 'Nothing here is a real event — these are our own images, shown to give you a feel for the layout.'
              : 'The images are illustrations, not photographs, and nothing here is a real event.'}{' '}
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
              // Remounts on a switch, so sort order and any enlarged photo
              // reset rather than carrying a selection from one event into
              // another where that id does not exist.
              key={active.key}
              photos={active.photos}
              eventName={active.event.name}
              canDownload={false}
              canOrderPrints={false}
              downloadMessage="Downloads are turned off on the sample. On a real event, guests download full-resolution photos with no account — one at a time or the whole gallery as a ZIP."
            />
          </div>

          <div className="spx-card mt-12 p-7">
            <p className="spx-eyebrow">Your turn</p>
            <h2 className="mt-2">
              <span className="spx-display block text-3xl sm:text-4xl">Your gallery,</span>
              <span className="spx-display-serif block text-3xl sm:text-4xl">
                with your photos.
              </span>
            </h2>
            <p className="spx-body mt-3 max-w-lg text-sm">
              Every angle of your day in one place, from everyone who was there. Set it up in
              about a minute.
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
