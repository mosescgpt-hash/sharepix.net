import { artworkFor, type ImageSlot } from '@/lib/imagery';

interface ArtworkProps {
  slot: ImageSlot;
  /** Tailwind classes for the frame — aspect ratio, sizing, the arch. */
  className?: string;
  /** Caption rendered over the image, used by occasion tiles. */
  caption?: string;
  /** Above-the-fold images should not lazy-load. */
  priority?: boolean;
}

/**
 * Renders whatever `lib/imagery` says belongs in a slot. Pages name a slot and
 * a frame; they never name a file, an aspect ratio or an alt string. When the
 * licensed photography lands, the registry changes and no page does.
 *
 * A slot with no photo renders nothing — not a broken <img>, and not a tinted
 * placeholder block, which looked like a page somebody had not finished.
 */
export default function Artwork({ slot, className = '', caption, priority = false }: ArtworkProps) {
  const art = artworkFor(slot);

  if (art.kind === 'photo') {
    return (
      <div className={`spx-tile ${className}`}>
        {/* Plain <img>: next/image wants a loader configuration this project
            does not have, and these are static marketing assets. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={art.src}
          alt={art.alt}
          width={art.width}
          height={art.height}
          loading={priority ? 'eager' : 'lazy'}
          className="h-full w-full object-cover"
        />
        {caption ? (
          <span className="spx-tile-caption bg-gradient-to-t from-charcoal/70 to-transparent">
            {caption}
          </span>
        ) : null}
      </div>
    );
  }

  // No photo, no tile. A tinted block with a caption over it read as an
  // unfinished page, so a slot without a photograph renders nothing at all
  // and the layout closes up around it.
  return null;
}
