import { LINK_REPLACED_NOTICE, SHARING_PAUSED_NOTICE } from '@/lib/galleryAccess';

interface GalleryAccessNoticeProps {
  /** Why the guest sees no gallery: the host paused sharing, or the link they hold was replaced. */
  reason: 'paused' | 'replaced';
  /** 'the gallery' or 'the slideshow', for the heading. */
  what?: string;
  /** Dark background (the venue screen) rather than the canvas page. */
  dark?: boolean;
}

/**
 * Tells a guest why there is nothing to see, in place of the gallery. Nothing to
 * enter or retry: the server decided, and only the host can change it.
 */
export default function GalleryAccessNotice({ reason, what = 'the gallery', dark = false }: GalleryAccessNoticeProps) {
  const paused = reason === 'paused';
  return (
    <div
      role="status"
      className={`mx-auto w-full max-w-sm border p-6 ${
        dark ? 'border-canvas/20 bg-ink text-canvas' : 'border-charcoal/10 bg-paper text-charcoal'
      }`}
    >
      <h2 className="spx-display-serif text-2xl">
        {paused ? `Sharing is paused` : `This link was replaced`}
      </h2>
      <p className={`mt-2 text-sm ${dark ? 'text-canvas/80' : 'text-charcoal/70'}`}>
        {paused ? SHARING_PAUSED_NOTICE : LINK_REPLACED_NOTICE}
      </p>
      <p className={`mt-2 text-xs ${dark ? 'text-canvas/60' : 'text-charcoal/60'}`}>
        This only affects {what}; adding photos still works.
      </p>
    </div>
  );
}
