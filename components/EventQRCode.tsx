import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import type QRCodeStyling from 'qr-code-styling';
import type { DotType, Options } from 'qr-code-styling';

interface EventQRCodeProps {
  eventId: string;
  eventName: string;
  /** Standard/Premium tiers can customize the QR style and center image. */
  allowCustomization?: boolean;
}

const STYLE_OPTIONS: Array<{ value: DotType; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'classy-rounded', label: 'Modern' },
];

export default function EventQRCode({
  eventId,
  eventName,
  allowCustomization = false,
}: EventQRCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const qrCodeRef = useRef<QRCodeStyling | null>(null);
  const [fgColor, setFgColor] = useState('#123851');
  const [dotStyle, setDotStyle] = useState<DotType>('square');
  const [centerImage, setCenterImage] = useState<string>();
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState('');

  useEffect(() => {
    setUploadUrl(`${window.location.origin}/event/${eventId}/upload`);
  }, [eventId]);

  const qrOptions = useMemo<Options>(() => {
    const roundedCorners = dotStyle === 'rounded' || dotStyle === 'classy-rounded';
    return {
      width: 240,
      height: 240,
      type: 'canvas',
      data: uploadUrl,
      image: centerImage,
      margin: 10,
      qrOptions: { errorCorrectionLevel: 'H' },
      dotsOptions: { type: dotStyle, color: fgColor },
      cornersSquareOptions: {
        type: dotStyle === 'dots' ? 'dot' : roundedCorners ? 'extra-rounded' : 'square',
        color: fgColor,
      },
      cornersDotOptions: {
        type: dotStyle === 'dots' ? 'dot' : roundedCorners ? 'extra-rounded' : 'square',
        color: fgColor,
      },
      backgroundOptions: { color: '#ffffff' },
      imageOptions: {
        hideBackgroundDots: true,
        imageSize: 0.24,
        margin: 5,
      },
    };
  }, [centerImage, dotStyle, fgColor, uploadUrl]);

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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setImageError('Use a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setImageError('Choose an image smaller than 3 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setCenterImage(String(reader.result));
    reader.onerror = () => setImageError('That image could not be read. Please try another one.');
    reader.readAsDataURL(file);
  }

  async function handleDownloadPng() {
    await qrCodeRef.current?.download({
      name: `${eventName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-qr`,
      extension: 'png',
    });
  }

  if (!uploadUrl) return null;

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-ink/10 bg-white p-5 text-center sm:p-6">
      <div className="rounded-2xl border border-ink/10 bg-white p-2 shadow-sm">
        <div ref={containerRef} className="h-[240px] w-[240px] overflow-hidden" aria-label="Event upload QR code" />
      </div>
      <p className="text-sm text-ink/70">
        Guests scan this code to upload photos and videos to <strong>{eventName}</strong>.
      </p>
      <p className="max-w-full break-all text-xs text-ink/50">{uploadUrl}</p>

      {allowCustomization ? (
        <div className="w-full space-y-4 rounded-xl bg-smoke p-4 text-left">
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
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-ink/15 bg-white hover:border-accent'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 text-sm font-semibold">
            QR color
            <input
              type="color"
              value={fgColor}
              onChange={(e) => setFgColor(e.target.value)}
              aria-label="QR code color"
              className="h-10 w-16 cursor-pointer rounded border border-ink/15 bg-white p-1"
            />
          </label>

          <div>
            <span className="block text-sm font-semibold">Center photo or logo</span>
            <p className="mt-1 text-xs text-ink/55">
              A simple square image scans best. SharePix keeps it small and uses high error correction.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent">
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
            {imageError ? <p className="mt-2 text-xs text-red-700">{imageError}</p> : null}
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-smoke px-3 py-2 text-xs text-ink/55">
          Starter includes the standard square QR design.
        </p>
      )}

      <button
        type="button"
        onClick={handleDownloadPng}
        className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent/90"
      >
        Download QR code (PNG)
      </button>
    </div>
  );
}
