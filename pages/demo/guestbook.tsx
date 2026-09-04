import Link from 'next/link';
import Layout from '@/components/Layout';
import GuestBookAlbum from '@/components/GuestBookAlbum';
import { DEMO_EVENT, DEMO_GUEST_BOOK, DEMO_PHOTOS } from '@/lib/demoEvent';

/**
 * The guest book, as a prospect sees it before buying anything.
 *
 * Renders through the same GuestBookAlbum the real page uses, so this cannot
 * quietly become a prettier version of the product. Nothing here writes: the
 * form is the one thing deliberately left out, because a demo that accepts
 * notes is a demo that collects strangers' words with nowhere to put them.
 */
export default function DemoGuestBookPage() {
  const photosById = new Map(DEMO_PHOTOS.map((photo) => [photo.id, photo]));

  return (
    <Layout title="A sample guest book">
      <section className="mx-auto max-w-2xl py-10">
        <div className="text-center">
          <p className="sp-eyebrow">A worked example</p>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
            {DEMO_EVENT.name}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-muted">
            What guests leave behind besides photos. At a real event there is a
            form at the top of this page — here it is left out, so nothing you
            type ends up somewhere it does not belong.
          </p>
        </div>

        <div className="mt-12">
          <GuestBookAlbum
            entries={DEMO_GUEST_BOOK}
            mediaFor={(id) => {
              const photo = photosById.get(id);
              if (!photo) return undefined;
              return { url: photo.url, fallbackUrl: photo.fallbackUrl, s3Key: photo.s3Key };
            }}
          />
        </div>

        <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/demo/gallery" className="sp-btn-ghost">
            See the sample gallery
          </Link>
          <Link href="/create-event" className="sp-btn-primary">
            Create your event
          </Link>
        </div>

        <p className="mt-8 text-center text-sm text-muted">
          The guest book is included on Premium and Corporate, and a $19 add-on
          on the other plans. <Link href="/pricing" className="text-accent underline">See pricing</Link>.
        </p>
      </section>
    </Layout>
  );
}
