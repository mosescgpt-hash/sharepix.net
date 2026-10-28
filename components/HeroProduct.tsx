import { HOMEPAGE_IMAGES } from '@/lib/homepageImages';

/**
 * The hero picture: what a guest sees on their phone next to what everyone
 * sees in the shared gallery. Both are screenshots of the real app — see
 * lib/homepageImages.ts. The phone frame is CSS, not an image.
 */
export default function HeroProduct() {
  const guest = HOMEPAGE_IMAGES.heroGuestUpload;
  const gallery = HOMEPAGE_IMAGES.heroGallery;
  return (
    <div className="mx-auto flex w-full max-w-xs items-end gap-3 sm:max-w-md sm:gap-4 lg:ml-auto lg:max-w-[26rem]">
      <figure className="w-[40%] shrink-0">
        <div className="overflow-hidden rounded-[1.4rem] border-[4px] border-ink bg-ink shadow-xl sm:rounded-[1.8rem] sm:border-[5px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={guest.src}
            alt={guest.alt}
            width={guest.width}
            height={guest.height}
            className="block h-auto w-full rounded-[1rem] sm:rounded-[1.4rem]"
            fetchPriority="high"
          />
        </div>
        <figcaption className="mt-1.5 text-center text-xs text-charcoal/70">
          What a guest sees
        </figcaption>
      </figure>

      <div className="min-w-0 flex-1">
        <div className="overflow-hidden rounded-xl border border-charcoal/10 bg-paper shadow-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={gallery.src}
            alt={gallery.alt}
            width={gallery.width}
            height={gallery.height}
            className="block h-auto w-full"
            fetchPriority="high"
          />
        </div>
        <p className="mt-2 text-center text-xs text-charcoal/70">What everyone sees</p>
      </div>
    </div>
  );
}
