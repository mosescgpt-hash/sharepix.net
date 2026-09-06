import { useEffect, useMemo, useRef } from 'react';
import type { Options } from 'qr-code-styling';
import { brandingForEvent, qrStylingOptions } from '@/lib/qrBranding';

interface StyledQrCodeProps {
  /** What the code encodes. */
  data: string;
  size: number;
  margin?: number;
  /** The event's saved style. Absent renders the default navy squares. */
  branding?: { qrDotStyle?: string | null; qrColor?: string | null; qrLogo?: string | null } | null;
  label?: string;
}

/**
 * An event's QR code, in the style its host saved.
 *
 * Exists so a moment's printed card carries the same design as the event's own
 * table tent. Before this, moment codes were drawn by a different library
 * entirely and always came out plain — a host would style their code, print
 * their tent, then print moment cards that looked like a different event.
 *
 * `qr-code-styling` is imported dynamically because it is only needed on the
 * few pages that draw a code, and it is not small.
 */
export default function StyledQrCode({
  data,
  size,
  margin = 10,
  branding = null,
  label,
}: StyledQrCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const options = useMemo(
    () => qrStylingOptions(brandingForEvent(branding), { data, size, margin }) as Options,
    [branding, data, margin, size],
  );

  useEffect(() => {
    if (!data || !containerRef.current) return;
    let active = true;

    import('qr-code-styling').then(({ default: QRCodeStyling }) => {
      if (!active || !containerRef.current) return;
      const code = new QRCodeStyling(options);
      containerRef.current.replaceChildren();
      code.append(containerRef.current);
    });

    return () => {
      active = false;
    };
  }, [data, options]);

  return (
    <div
      ref={containerRef}
      aria-label={label}
      role={label ? 'img' : undefined}
      style={{ width: size, height: size }}
      className="overflow-hidden"
    />
  );
}
