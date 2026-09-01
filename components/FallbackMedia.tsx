import { ImgHTMLAttributes, VideoHTMLAttributes } from 'react';
import { useMediaSource } from '@/lib/useMediaSource';
import type { MediaSource } from '@/lib/mediaSource';

/**
 * An <img>/<video> that loads from Cloudflare R2 and falls back to S3.
 *
 * Gallery media is signed for both, because signing costs nothing either way,
 * and the browser is what settles which one works. That avoids the alternative
 * — asking the server to check each object exists before signing it — which is
 * a network round trip per photo and the one thing that doesn't scale to a
 * gallery.
 *
 * A source with no fallback behaves exactly like a plain element: one src, and
 * a failure is a failure. The swap happens at most once (see lib/mediaSource),
 * so a URL that fails on both can't spin the browser in an onError loop.
 */

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> & {
  source: MediaSource;
  alt: string;
};

export function FallbackImage({ source, alt, ...rest }: ImageProps) {
  const { src, onError } = useMediaSource(source);
  // Signed URLs change constantly, so a plain img is simpler than next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...rest} src={src} alt={alt} onError={onError} />;
}

type VideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'onError'> & {
  source: MediaSource;
};

export function FallbackVideo({ source, ...rest }: VideoProps) {
  const { src, onError } = useMediaSource(source);
  return <video {...rest} src={src} onError={onError} />;
}
