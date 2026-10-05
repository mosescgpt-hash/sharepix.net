/**
 * One photo from the sample galleries (public/site/gallery), in the same tile
 * frame and caption style as <Artwork>. For pages that want a picture of a
 * particular kind of event rather than a generic slot, with alt text that
 * describes this exact photo.
 */
export default function SamplePhoto({
  src,
  alt,
  className = '',
  caption,
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  caption?: string;
  priority?: boolean;
}) {
  return (
    <div className={`spx-tile ${className}`}>
      {/* Plain <img>, as in Artwork: static marketing assets, no loader. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={1200}
        height={900}
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
