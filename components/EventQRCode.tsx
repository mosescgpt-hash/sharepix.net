import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type QRCodeStyling from 'qr-code-styling';
import type { Options } from 'qr-code-styling';
import { saveEventQrBranding } from '@/lib/api';
import type { QrDotStyle } from '@/lib/qrBranding';
import {
  DEFAULT_QR_COLOR,
  QR_DOT_STYLES,
  brandingForEvent,
  qrColorVerdict,
  qrStylingOptions,
} from '@/lib/qrBranding';
import { prepareQrLogo } from '@/lib/qrLogoImage';

interface EventQRCodeProps {
  eventId: string;
  eventName: string;
  /** Plans above the retired Starter can restyle the code and add a logo. */
  allowCustomization?: boolean;
  /**
   * The event's saved style. Passing it makes this the editor for a real
   * event: changes are saved and come back on the next visit. Without it the
   * component still renders, just unsaved — which is how the create-event
   * confirmation screen uses it, before there is anything to save against.
   */
  branding?: { qrDotStyle?: string | null; qrColor?: string | null; qrLogo?: string | null } | null;
  /** Called after a successful save, so the page can refresh its event. */
  onBrandingSaved?: () => void;
}

const STYLE_LABELS: Record<(typeof QR_DOT_STYLES)[number], string> = {
  square: 'Square',
  rounded: 'Rounded',
  dots: 'Dots',
  'classy-rounded': 'Modern',
};
// Typed as our own four rather than the library's wider DotType: the styles we
// offer are the styles we store, and the two must not drift apart.
const STYLE_OPTIONS: Array<{ value: QrDotStyle; label: string }> = QR_DOT_STYLES.map((value) => ({
  value,
  label: STYLE_LABELS[value],
}));

export default function EventQRCode({
  eventId,
  eventName,
  allowCustomization = false,
  branding = null,
  onBrandingSaved,
}: EventQRCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const qrCodeRef = useRef<QRCodeStyling | null>(null);
  const saved = useMemo(() => brandingForEvent(branding), [branding]);

  const [fgColor, setFgColor] = useState(saved.qrColor);
  const [dotStyle, setDotStyle] = useState<QrDotStyle>(saved.qrDotStyle);
  const [centerImage, setCenterImage] = useState<string | undefined>(saved.qrLogo ?? undefined);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // The event loads after the first render, so the saved style arrives late.
  useEffect(() => {
    setFgColor(saved.qrColor);
    setDotStyle(saved.qrDotStyle);
    setCenterImage(saved.qrLogo ?? undefined);
  }, [saved]);

  useEffect(() => {
    setUploadUrl(`${window.location.origin}/event/${eventId}/upload`);
  }, [eventId]);

  const dirty =
    fgColor !== saved.qrColor ||
    dotStyle !== saved.qrDotStyle ||
    (centerImage ?? null) !== saved.qrLogo;

  const colourVerdict = qrColorVerdict(fgColor);

  async function handleSaveBranding() {
    if (saving) return;
    setSaving(true);
    setSaveNote(null);
    try {
      await saveEventQrBranding(eventId, {
        qrDotStyle: dotStyle,
        qrColor: fgColor,
        qrLogo: centerImage ?? null,
      });
      setSaveNote('Saved. This is the code on your table tent and brochure too.');
      onBrandingSaved?.();
    } catch (error) {
      setSaveNote(
        error instanceof Error ? error.message : 'Your QR code style could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  // One builder for every surface. Before this, the dashboard, the table tent
  // and the brochure each described the code themselves, and only the dashboard
  // was styleable — so the printed card never matched what the host designed.
  const qrOptions = useMemo<Options>(
    () =>
      qrStylingOptions(
        { qrDotStyle: dotStyle, qrColor: fgColor, qrLogo: centerImage ?? null },
        { data: uploadUrl, size: 240, margin: 10 },
      ) as Options,
    [centerImage, dotStyle, fgColor, uploadUrl],
  );

  useEffect(() => {
    if (!uploadUrl || !containerRef.current) return;
    let active = true;

    import('qr-code-styling').then(({ default: QRCodeStylingConstructor }) => {
      if (!active || !containerRef.current) return;
      const qrCode = new QRCodeStylingConstructor(qrOptions);
      containerRef.current.replaceChildren();
      qrCode.append(containerRef.current);
      qrCodeRef.current = qrCode;
    });

    return () => {
      active = false;
      qrCodeRef.current = null;
    };
  }, [qrOptions, uploadUrl]);

  async function handleCenterImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImageError(null);
    // Downscaled here rather than stored whole: the centre image renders at
    // about a quarter of the code, and the small version is what makes storing
    // it on the event row viable at all.
    const prepared = await prepareQrLogo(file);
    if (!prepared.ok) {
      setImageError(prepared.reason);
      return;
    }
    setCenterImage(prepared.dataUrl);
  }

  async function handleDownloadPng() {
    await qrCodeRef.current?.download({
      name: `${eventName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-qr`,
      extension: 'png',
    });
  }

  if (!uploadUrl) return null;

  return (
    <div className="spx-card flex flex-col items-center gap-4 p-5 text-center sm:p-6">
      <div className="border border-charcoal/10 bg-paper p-2">
        <div ref={containerRef} className="h-[240px] w-[240px] overflow-hidden" aria-label="Event upload QR code" />
      </div>
      <p className="text-sm text-charcoal/70">
        Guests scan this code to upload photos and videos to <strong>{eventName}</strong>.
      </p>
      <p className="max-w-full break-all text-xs text-charcoal/60">{uploadUrl}</p>

      {allowCustomization ? (
        <div className="w-full space-y-4 bg-sand p-4 text-left">
          <div>
            <span className="block text-sm font-semibold">QR style</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDotStyle(option.value)}
                  aria-pressed={dotStyle === option.value}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    dotStyle === option.value
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-charcoal/15 bg-paper hover:border-charcoal/40'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center justify-between gap-3 text-sm font-semibold">
              QR color
              <input
                type="color"
                value={fgColor}
                onChange={(e) => setFgColor(e.target.value)}
                aria-label="QR code color"
                className="h-10 w-16 cursor-pointer border border-charcoal/20 bg-white p-1"
              />
            </label>
            {/* A printed code that will not scan is discovered at the event,
                after the cards are made. Blocked below the floor, warned above
                it — the server refuses the same colours. */}
            {colourVerdict === 'unscannable' ? (
              <p className="mt-2 text-xs text-red-700" role="alert">
                Too light to scan reliably once printed. Choose a darker shade.
              </p>
            ) : colourVerdict === 'marginal' ? (
              <p className="mt-2 text-xs text-amber-700">
                This scans in good light but can struggle in a dim room. A darker shade is safer
                for printed cards.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => setFgColor(DEFAULT_QR_COLOR)}
              className="mt-2 text-xs text-charcoal/60 underline transition hover:text-charcoal"
            >
              Reset to the SharePix navy
            </button>
          </div>

          <div>
            <span className="block text-sm font-semibold">Center photo or logo</span>
            <p className="mt-1 text-xs text-charcoal/60">
              A simple square image scans best. SharePix keeps it small and uses high error correction.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="cursor-pointer border border-charcoal/25 bg-paper px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60">
                {centerImage ? 'Change image' : 'Add image'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleCenterImage}
                  className="sr-only"
                />
              </label>
              {centerImage ? (
                <button
                  type="button"
                  onClick={() => setCenterImage(undefined)}
                  className="rounded-full px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  Remove image
                </button>
              ) : null}
            </div>
            {imageError ? (
              <p className="mt-2 text-xs text-red-700" role="alert">
                {imageError}
              </p>
            ) : null}
          </div>

          {/* Saving is explicit. A host tries several looks before settling, and
              writing each experiment to the event would mean the table tent
              changed under them while they were still deciding. */}
          <div className="border-t border-charcoal/15 pt-4">
            <button
              type="button"
              onClick={() => void handleSaveBranding()}
              disabled={saving || !dirty || colourVerdict === 'unscannable'}
              className="spx-btn-ink w-full disabled:opacity-50"
            >
              {saving ? 'Saving…' : dirty ? 'Save this design' : 'Saved'}
            </button>
            <p className="mt-2 text-xs text-charcoal/60">
              Saved once and used everywhere — the dashboard, the table tent, the brochure, and
              every reprint, until you change it again.
            </p>
            {saveNote ? <p className="mt-2 text-xs text-charcoal/70">{saveNote}</p> : null}
          </div>
        </div>
      ) : (
        <p className="bg-sand px-3 py-2 text-xs text-charcoal/60">
          This plan includes the standard square QR design.
        </p>
      )}

      <button
        type="button"
        onClick={handleDownloadPng}
        className="bg-ink px-5 py-3 text-sm font-medium text-canvas transition hover:bg-night"
      >
        Download QR code (PNG)
      </button>
    </div>
  );
}
