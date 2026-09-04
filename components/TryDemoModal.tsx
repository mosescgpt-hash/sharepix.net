import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';

const DEMO_PATH = '/demo/try';

/**
 * "Try the live demo" — a QR to the walkthrough, plus the same link.
 *
 * The QR is not doing anything clever: it is the same URL as the link beside
 * it. The point is to move the demo onto a phone, because a phone is what a
 * guest actually holds, and the flow reads completely differently with a
 * camera roll behind the file picker.
 *
 * The URL is built from window.location at open time rather than hardcoded, so
 * it works on a preview deployment and on localhost without anyone remembering
 * to change it.
 */
export default function TryDemoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setUrl(`${window.location.origin}${DEMO_PATH}`);
  }, [open]);

  // Escape closes, and focus moves into the dialog so a keyboard user is not
  // left behind on the page underneath.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while a full-screen overlay is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="try-demo-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-night/70 backdrop-blur-sm"
      />
      <div className="spx-card relative w-full max-w-md p-7 text-center sm:p-9">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center text-charcoal/60 transition hover:bg-charcoal/5 hover:text-charcoal"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>

        <p className="spx-eyebrow">Try it yourself</p>
        <h2
          id="try-demo-title"
          className="mt-4 font-sans text-2xl font-bold tracking-[-0.02em]"
        >
          Scan to try it on your phone
        </h2>
        <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-charcoal/60">
          Add a photo, approve it as the host, and watch it reach the gallery and the
          venue screen. Your photo never leaves your device.
        </p>

        <div className="mx-auto mt-7 w-fit border border-charcoal/12 bg-paper p-4">
          {url ? (
            <QRCodeSVG value={url} size={192} fgColor="#123851" bgColor="#FFFFFF" level="M" />
          ) : (
            <div className="h-48 w-48 animate-pulse bg-charcoal/[0.06]" />
          )}
        </div>

        <p className="mt-6 text-sm text-charcoal/60">
          Or{' '}
          <Link href={DEMO_PATH} className="font-medium text-accent underline">
            open the demo here
          </Link>{' '}
          — the QR goes to the same place.
        </p>
      </div>
    </div>
  );
}
