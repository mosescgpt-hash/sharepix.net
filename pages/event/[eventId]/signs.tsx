import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { withHostAuth } from '@/components/hostAuth';
import SignPreview from '@/components/signKit/SignPreview';
import { signContent } from '@/lib/signKit/content';
import { layoutSign, type SignContent } from '@/lib/signKit/layout';
import {
  SIGN_PIECES,
  SIGN_VARIANTS,
  pieceSizeLabel,
  signFilename,
  signKitZipName,
  type SignPiece,
  type SignVariantKey,
} from '@/lib/signKit/pieces';
import { buildSignPdf, measureWith } from '@/lib/signKit/render';
import type { Measure } from '@/lib/signKit/text';
import { useHostEvent } from '@/lib/signKit/useHostEvent';

type JsPdfModule = typeof import('jspdf');

/** Hand the browser a file. Works on iOS Safari, which ignores jsPDF's own save. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * The sign kit: every printable piece as a one-tap PDF, in light and dark.
 *
 * Generated in the browser — nothing about the event leaves the page — and
 * drawn as vector, so the QR stays sharp at poster size.
 */
function SignsPage() {
  const { eventId, event, loading, denied, error } = useHostEvent();
  const [variant, setVariant] = useState<SignVariantKey>('light');
  const [pdf, setPdf] = useState<JsPdfModule | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [host, setHost] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
    setHost(window.location.host);
    // Loaded here rather than bundled: only hosts on this page ever need it.
    import('jspdf')
      .then(setPdf)
      .catch(() => setFailed('The sign maker didn’t load. Check your connection and refresh.'));
  }, []);

  const content: SignContent | null = useMemo(
    () => (event && origin ? signContent(event, origin, host) : null),
    [event, origin, host],
  );

  const measure: Measure | null = useMemo(
    () => (pdf ? measureWith(new pdf.jsPDF({ unit: 'in', format: [8.5, 11], orientation: 'portrait' })) : null),
    [pdf],
  );

  const layouts = useMemo(() => {
    if (!content || !measure) return null;
    return SIGN_PIECES.map((piece) => ({
      piece,
      layout: layoutSign(piece, SIGN_VARIANTS[variant], content, measure),
    }));
  }, [content, measure, variant]);

  const download = (piece: SignPiece) => {
    if (!pdf || !content || !event) return;
    setFailed(null);
    setBusy(piece.key);
    try {
      const { doc } = buildSignPdf(pdf.jsPDF, piece, variant, content);
      saveBlob(doc.output('blob'), signFilename(event.name, piece, variant));
    } catch {
      setFailed('That PDF didn’t generate. Try again, or try another browser.');
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = async () => {
    if (!pdf || !content || !event) return;
    setFailed(null);
    setBusy('all');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const piece of SIGN_PIECES) {
        for (const key of Object.keys(SIGN_VARIANTS) as SignVariantKey[]) {
          const { doc } = buildSignPdf(pdf.jsPDF, piece, key, content);
          zip.file(signFilename(event.name, piece, key), doc.output('arraybuffer'));
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      saveBlob(blob, signKitZipName(event.name));
    } catch {
      setFailed('The ZIP didn’t generate. Download the signs one at a time instead.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas font-sans text-charcoal">
      <Head>
        <title>{event ? `${event.name} — signs` : 'Signs'} — sharepix.net</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href={eventId ? `/event/${eventId}/admin` : '/my-events'}
            className="text-sm font-medium text-charcoal/70 transition hover:text-charcoal"
          >
            ← Back to dashboard
          </Link>
          {eventId ? (
            <Link
              href={`/event/${eventId}/nfc`}
              className="text-sm font-medium text-charcoal/70 underline-offset-4 transition hover:text-charcoal hover:underline"
            >
              NFC tap tags →
            </Link>
          ) : null}
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {loading ? (
          <p className="text-center text-charcoal/60">Loading your signs…</p>
        ) : denied ? (
          <p className="mx-auto max-w-lg rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
            Only the event host or a sharepix.net global administrator can open these signs.
          </p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">{error}</p>
        ) : event ? (
          <>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-[-0.02em]">Signs</h1>
                <p className="mt-1 max-w-xl text-sm text-charcoal/60">
                  Print-ready PDFs for {event.name}. Each one has your event&apos;s QR code, so guests
                  scan and land straight on your upload page. Print at 100% (actual size), not
                  &ldquo;fit to page&rdquo;.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex border border-charcoal/25" role="group" aria-label="Colour">
                  {(Object.keys(SIGN_VARIANTS) as SignVariantKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setVariant(key)}
                      aria-pressed={variant === key}
                      className={`px-4 py-2 text-sm font-medium transition ${
                        variant === key ? 'bg-ink text-canvas' : 'text-charcoal hover:bg-sand'
                      }`}
                    >
                      {SIGN_VARIANTS[key].label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={downloadAll}
                  disabled={!pdf || busy !== null}
                  className="border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                >
                  {busy === 'all' ? 'Zipping…' : 'Download all (ZIP)'}
                </button>
              </div>
            </div>

            {failed ? (
              <p className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {failed}
              </p>
            ) : null}

            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {SIGN_PIECES.map((piece) => {
                const layout = layouts?.find((l) => l.piece.key === piece.key)?.layout;
                return (
                  <li key={piece.key} className="flex flex-col border border-ink/10 bg-white p-4">
                    <div className="flex h-56 items-center justify-center bg-sand/60 p-3">
                      {layout ? (
                        <div
                          className="h-full shadow-sm"
                          style={{ aspectRatio: `${layout.pageWidth} / ${layout.pageHeight}`, maxWidth: '100%' }}
                        >
                          <SignPreview layout={layout} title={`${piece.label} preview`} />
                        </div>
                      ) : (
                        <span className="text-sm text-charcoal/50">Preparing preview…</span>
                      )}
                    </div>
                    <h2 className="mt-3 font-semibold">
                      {piece.label} <span className="font-normal text-charcoal/60">· {pieceSizeLabel(piece)}</span>
                    </h2>
                    <p className="mt-1 flex-1 text-sm text-charcoal/60">{piece.use}</p>
                    {piece.kind === 'thanks' && !content?.closesLine ? (
                      <p className="mt-2 text-xs text-amber-800">
                        Uploads for this event are closed, so this card can&apos;t give a closing date.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => download(piece)}
                      disabled={!pdf || busy !== null}
                      className="mt-3 bg-ink px-4 py-2.5 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                    >
                      {busy === piece.key ? 'Making PDF…' : `Download ${SIGN_VARIANTS[variant].label.toLowerCase()} PDF`}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-8 border border-charcoal/10 bg-paper/70 p-5 text-sm text-charcoal/70">
              <p className="font-semibold text-charcoal">Before you print the lot</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Print one and scan it with your own phone first.</li>
                <li>
                  The 18 × 24 poster has bleed and crop marks: send it to a print shop as it is. The
                  others print edge to edge on card stock; trim to the coloured edge.
                </li>
                <li>
                  The &ldquo;or tap here&rdquo; mark is for an NFC sticker.{' '}
                  <Link href={`/event/${event.id}/nfc`} className="font-medium text-charcoal underline underline-offset-4">
                    How to set one up
                  </Link>
                  .
                </li>
              </ul>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

// Requires sign-in; useHostEvent limits it to the event's host or an admin.
export default withHostAuth(SignsPage, {
  purpose: 'Your printable signs.',
  arriving: 'returning',
});
