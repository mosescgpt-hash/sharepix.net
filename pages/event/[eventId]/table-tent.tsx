import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Head from 'next/head';
import type QRCodeStyling from 'qr-code-styling';
import { withAuthenticator } from '@aws-amplify/ui-react';
import { fetchEvent, fetchEventPhotos, getCurrentUserInfo } from '@/lib/api';
import { isGlobalAdmin } from '@/lib/admin';
import {
  DEFAULT_HEADLINE,
  DEFAULT_MESSAGE,
  DEFAULT_THEME_KEY,
  MAX_HEADLINE,
  MAX_MESSAGE,
  TENT_HEIGHT_IN,
  TENT_THEMES,
  TENT_WIDTH_IN,
  type TentContent,
  eventNameFontSize,
  tentContent,
} from '@/lib/tableTent';
import { DisplayPhoto, QREvent } from '@/lib/types';

/**
 * One face of the tent. Two of these print per sheet — the top one rotated so
 * that both read upright once the sheet is folded.
 *
 * Sizes are in inches and points rather than Tailwind classes: this is the one
 * page whose output is a physical object, and print sizing has to survive
 * whatever the browser does to screen units.
 */
function TentPanel({
  content,
  qrDataUrl,
  flipped = false,
}: {
  content: TentContent;
  qrDataUrl: string | null;
  /** The upper panel prints rotated so it reads upright once folded. */
  flipped?: boolean;
}) {
  const { theme } = content;
  return (
    <div
      className={`tent-panel${flipped ? ' tent-panel-flipped' : ''}`}
      style={{ background: theme.background, color: theme.text, borderColor: theme.border }}
    >
      <div className="tent-inner">
        {/* Left column: the words. */}
        <div className="tent-copy">
          {content.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={content.photoUrl}
              alt=""
              className="tent-photo"
              style={{ borderColor: theme.accent }}
            />
          ) : null}
          <p className="tent-headline" style={{ color: theme.accent }}>
            {content.headline}
          </p>
          <p
            className="tent-event-name"
            style={{ fontSize: `${eventNameFontSize(content.eventName)}pt` }}
          >
            {content.eventName}
          </p>
          {content.dateLine || content.locationLine ? (
            <p className="tent-meta">
              {[content.dateLine, content.locationLine].filter(Boolean).join(' · ')}
            </p>
          ) : null}
          <p className="tent-message">{content.message}</p>
          <p className="tent-brand">
            sharepix.net
            {content.code ? <span className="tent-code"> · code {content.code}</span> : null}
          </p>
        </div>

        {/* Right column: the code they actually scan. */}
        <div className="tent-qr-block">
          <div className="tent-qr-card" style={{ borderColor: theme.border }}>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR code to upload photos" className="tent-qr-img" />
            ) : (
              <div className="tent-qr-img" />
            )}
          </div>
          <p className="tent-url">{content.uploadUrl.replace(/^https?:\/\//, '')}</p>
        </div>
      </div>
    </div>
  );
}

function TableTentPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [event, setEvent] = useState<QREvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // Customization — every one of these starts at the default, so a host who
  // touches nothing still gets a finished tent.
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [themeKey, setThemeKey] = useState(DEFAULT_THEME_KEY);
  const [showDate, setShowDate] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [showCode, setShowCode] = useState(true);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const [ev, user, admin] = await Promise.all([
        fetchEvent(eventId),
        getCurrentUserInfo(),
        isGlobalAdmin().catch(() => false),
      ]);
      if (!ev) {
        setError('We couldn’t find that event.');
        return;
      }
      // The tent carries the event's upload link, so it stays with the host.
      const isOwner = !!user && !!ev.owner && ev.owner.includes(user.userId);
      if (!isOwner && !admin) {
        setDenied(true);
        return;
      }
      setEvent(ev);
    } catch {
      setError('Something went wrong loading the table tent. Try again in a moment.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!eventId) return;
    setUploadUrl(`${window.location.origin}/event/${eventId}/upload`);
  }, [eventId]);

  // Render the QR once, to a data URL, so both panels can show the same image
  // without generating it twice and without a canvas that print might drop.
  useEffect(() => {
    if (!uploadUrl || !event) return;
    let active = true;
    import('qr-code-styling').then(async ({ default: QRCodeStylingConstructor }) => {
      if (!active) return;
      const qrCode: QRCodeStyling = new QRCodeStylingConstructor({
        width: 640,
        height: 640,
        type: 'canvas',
        data: uploadUrl,
        margin: 12,
        // High correction so a fold crease, a smudge, or dim light still scans.
        qrOptions: { errorCorrectionLevel: 'H' },
        dotsOptions: { type: 'square', color: '#123851' },
        cornersSquareOptions: { type: 'square', color: '#123851' },
        cornersDotOptions: { type: 'square', color: '#123851' },
        // Always white behind the code regardless of the tent's theme — a
        // themed QR that looks good but will not scan is a wasted print.
        backgroundOptions: { color: '#ffffff' },
      });
      const blob = await qrCode.getRawData('png');
      if (!active || !blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (active) setQrDataUrl(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.readAsDataURL(blob as Blob);
    });
    return () => {
      active = false;
    };
  }, [uploadUrl, event]);

  const loadPhotos = useCallback(async () => {
    if (!eventId || photos.length > 0) return;
    setPhotosLoading(true);
    try {
      setPhotos(await fetchEventPhotos(eventId, { useThumbs: true }));
    } catch {
      // A photo is optional decoration; failing to list them is not an error
      // worth blocking the tent over.
    } finally {
      setPhotosLoading(false);
    }
  }, [eventId, photos.length]);

  const content = useMemo(
    () =>
      event
        ? tentContent(event, uploadUrl, {
            headline,
            message,
            themeKey,
            photoUrl,
            showDate,
            showLocation,
            showCode,
          })
        : null,
    [event, uploadUrl, headline, message, themeKey, photoUrl, showDate, showLocation, showCode],
  );

  const resetAll = () => {
    setHeadline('');
    setMessage('');
    setThemeKey(DEFAULT_THEME_KEY);
    setShowDate(true);
    setShowLocation(true);
    setShowCode(true);
    setPhotoUrl(null);
  };

  const customized =
    headline !== '' ||
    message !== '' ||
    themeKey !== DEFAULT_THEME_KEY ||
    !showDate ||
    !showLocation ||
    !showCode ||
    photoUrl !== null;

  return (
    <div className="min-h-screen bg-canvas font-sans text-charcoal">
      <Head>
        <title>{event ? `${event.name} — table tent` : 'Table tent'} — sharepix.net</title>
      </Head>

      <style jsx global>{`
        /* One portrait Letter sheet, no browser margins — the panels own the
           whole page so the fold lands exactly halfway down. */
        @page {
          size: letter portrait;
          margin: 0;
        }

        .tent-sheet {
          width: ${TENT_WIDTH_IN}in;
          margin: 0 auto;
        }

        .tent-panel {
          width: ${TENT_WIDTH_IN}in;
          height: ${TENT_HEIGHT_IN}in;
          box-sizing: border-box;
          border: 1px solid;
          overflow: hidden;
        }

        /* The top panel prints upside down, so once the sheet is folded both
           faces read upright to the people on either side of the table. */
        .tent-panel-flipped {
          transform: rotate(180deg);
        }

        .tent-inner {
          display: flex;
          align-items: center;
          gap: 0.3in;
          height: 100%;
          box-sizing: border-box;
          padding: 0.45in 0.5in;
        }

        .tent-copy {
          flex: 1 1 auto;
          min-width: 0;
        }

        .tent-photo {
          display: block;
          width: 100%;
          max-width: 3.4in;
          height: 1.05in;
          object-fit: cover;
          border: 2px solid;
          border-radius: 0.08in;
          margin-bottom: 0.12in;
        }

        .tent-headline {
          margin: 0;
          font-size: 12.5pt;
          font-weight: 700;
          letter-spacing: 0.09em;
          text-transform: uppercase;
        }

        .tent-event-name {
          margin: 0.06in 0 0;
          font-weight: 800;
          line-height: 1.1;
          overflow-wrap: break-word;
        }

        .tent-meta {
          margin: 0.08in 0 0;
          font-size: 12pt;
          opacity: 0.75;
        }

        .tent-message {
          margin: 0.14in 0 0;
          font-size: 12pt;
          line-height: 1.35;
          opacity: 0.9;
        }

        .tent-brand {
          margin: 0.18in 0 0;
          font-size: 10pt;
          font-weight: 600;
          opacity: 0.6;
        }

        .tent-code {
          font-weight: 400;
        }

        .tent-qr-block {
          flex: 0 0 auto;
          text-align: center;
        }

        .tent-qr-card {
          background: #ffffff;
          border: 2px solid;
          border-radius: 0.1in;
          padding: 0.09in;
        }

        .tent-qr-img {
          display: block;
          width: 2.9in;
          height: 2.9in;
        }

        .tent-url {
          margin: 0.07in 0 0;
          font-size: 8pt;
          max-width: 3.1in;
          overflow-wrap: break-word;
          opacity: 0.75;
        }

        /* The fold guide is an on-screen and on-paper aid, not part of the
           design — it sits exactly on the crease. */
        .tent-fold {
          display: flex;
          align-items: center;
          gap: 0.12in;
          height: 0;
          font-size: 7pt;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #9aa5ab;
        }

        .tent-fold::before,
        .tent-fold::after {
          content: '';
          flex: 1 1 auto;
          border-top: 1px dashed #c3ccd1;
        }

        @media print {
          /* Print the panel backgrounds, not just the text. */
          .tent-panel {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            border: none;
          }
          /* Two 5.5in panels come to exactly one Letter sheet. Pinning the
             height and clipping keeps a sub-pixel rounding error from
             spilling into a blank second page. */
          .tent-sheet {
            margin: 0;
            height: 11in;
            overflow: hidden;
          }
        }
      `}</style>

      {/* Toolbar — hidden when printing */}
      <div className="print:hidden border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href={eventId ? `/event/${eventId}/admin` : '/my-events'}
            className="text-sm font-medium text-charcoal/70 transition hover:text-charcoal"
          >
            ← Back to dashboard
          </Link>
          {event ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-ink px-5 py-2.5 text-sm font-medium text-canvas transition hover:bg-night"
            >
              Print / Save as PDF
            </button>
          ) : null}
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {loading ? (
          <p className="text-center text-charcoal/60">Loading table tent…</p>
        ) : denied ? (
          <p className="mx-auto max-w-lg rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
            Only the event host or a sharepix.net global administrator can open this table tent.
          </p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">
            {error}
          </p>
        ) : event && content ? (
          <>
            <div className="print:hidden mx-auto mb-6 max-w-2xl rounded-2xl border border-ink/10 bg-white p-5">
              <h1 className="font-sans text-xl font-bold tracking-[-0.02em]">Table tent</h1>
              <p className="mt-1 text-sm text-charcoal/60">
                Print one sheet, fold it in half across the dashed line, and stand it on the
                table. Both sides read right way up. It&apos;s ready to print as-is — the
                options below are only if you want to change something.
              </p>
            </div>

            {/* The printable sheet: two panels and the fold line between them. */}
            <div className="tent-sheet">
              <TentPanel content={content} qrDataUrl={qrDataUrl} flipped />
              <div className="tent-fold">
                <span>Fold here</span>
              </div>
              <TentPanel content={content} qrDataUrl={qrDataUrl} />
            </div>

            {/* Customization — everything below is optional. */}
            <div className="print:hidden mx-auto mt-8 max-w-2xl rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-sans text-lg font-bold tracking-[-0.02em]">Make it yours (optional)</h2>
                {customized ? (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="text-sm font-medium text-charcoal/60 underline transition hover:text-charcoal"
                  >
                    Reset to the default
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium">Headline</span>
                  <input
                    type="text"
                    value={headline}
                    maxLength={MAX_HEADLINE}
                    placeholder={DEFAULT_HEADLINE}
                    onChange={(e) => setHeadline(e.target.value)}
                    className="spx-input mt-2"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Message</span>
                  <textarea
                    value={message}
                    maxLength={MAX_MESSAGE}
                    rows={3}
                    placeholder={DEFAULT_MESSAGE}
                    onChange={(e) => setMessage(e.target.value)}
                    className="spx-input mt-2"
                  />
                </label>
              </div>

              <fieldset className="mt-5">
                <legend className="text-sm font-medium">Colour</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TENT_THEMES.map((theme) => (
                    <button
                      key={theme.key}
                      type="button"
                      onClick={() => setThemeKey(theme.key)}
                      aria-pressed={themeKey === theme.key}
                      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${
                        themeKey === theme.key
                          ? 'border-ink bg-ink text-canvas'
                          : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 rounded-full border border-ink/20"
                        style={{ background: theme.background }}
                      />
                      {theme.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mt-5">
                <legend className="text-sm font-medium">Show on the tent</legend>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showDate}
                      onChange={(e) => setShowDate(e.target.checked)}
                    />
                    Date
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showLocation}
                      onChange={(e) => setShowLocation(e.target.checked)}
                      disabled={!event.location}
                    />
                    City and state
                    {!event.location ? (
                      <span className="text-charcoal/60">(add one in Event settings)</span>
                    ) : null}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showCode}
                      onChange={(e) => setShowCode(e.target.checked)}
                    />
                    Event code
                  </label>
                </div>
              </fieldset>

              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-medium">Photo (optional)</span>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotosOpen((open) => !open);
                      loadPhotos();
                    }}
                    className="text-sm font-medium text-pine underline"
                  >
                    {photosOpen ? 'Hide photos' : 'Pick from this event'}
                  </button>
                </div>
                {photoUrl ? (
                  <button
                    type="button"
                    onClick={() => setPhotoUrl(null)}
                    className="mt-2 text-sm text-charcoal/60 underline transition hover:text-charcoal"
                  >
                    Remove the photo
                  </button>
                ) : null}
                {photosOpen ? (
                  photosLoading ? (
                    <p className="mt-3 text-sm text-charcoal/60">Loading photos…</p>
                  ) : photos.length === 0 ? (
                    <p className="mt-3 text-sm text-charcoal/60">
                      No photos yet. Once guests start uploading, you can put one on the tent.
                    </p>
                  ) : (
                    <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                      {photos.slice(0, 24).map((photo) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => setPhotoUrl(photo.url)}
                          aria-pressed={photoUrl === photo.url}
                          className={`overflow-hidden rounded-lg border-2 ${
                            photoUrl === photo.url ? 'border-ink' : 'border-transparent'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo.url}
                            alt=""
                            className="h-16 w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      ))}
                    </div>
                  )
                ) : null}
              </div>
            </div>

            <div className="print:hidden mx-auto mt-6 max-w-2xl border border-charcoal/10 bg-paper/70 p-5 text-sm text-charcoal/60">
              <p className="font-medium text-ink">Printing tips</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Use Letter paper, portrait, and set scale to 100% (not &ldquo;fit to page&rdquo;).</li>
                <li>Turn on background graphics so the colour prints.</li>
                <li>Card stock stands up better than copy paper, but either works.</li>
                <li>Scan the printed code with your own phone before you make the rest.</li>
              </ul>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

// Requires sign-in; the owner/admin check above limits it to the event's host.
export default withAuthenticator(TableTentPage);
