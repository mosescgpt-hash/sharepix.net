import { useEffect, useState } from 'react';
import { initialSource, sourceAfterError, type MediaSource } from '@/lib/mediaSource';

/**
 * `src` and `onError` for an <img> or <video> that should try R2 first and fall
 * back to S3.
 *
 * Spread the result onto the element. When the primary fails the src swaps
 * once; when there is nothing left to try, `onError` stops touching it, so the
 * element ends in the browser's normal broken state rather than in a retry
 * loop. The decision itself is in lib/mediaSource, where it's tested.
 */
export function useMediaSource(source: MediaSource): {
  src: string;
  onError: () => void;
} {
  const [src, setSrc] = useState(() => initialSource(source));

  // A gallery re-signs its URLs periodically, and the slideshow swaps photos in
  // place, so the element can be handed a new source without remounting.
  useEffect(() => {
    setSrc(initialSource(source));
  }, [source.primary, source.fallback]);

  return {
    src,
    onError: () => {
      const next = sourceAfterError(src, source);
      if (next) setSrc(next);
    },
  };
}
