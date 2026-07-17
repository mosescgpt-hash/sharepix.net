import { useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

interface EventQRCodeProps {
  eventId: string;
  eventName: string;
  /** Standard/Premium tiers can customize the QR color. */
  allowCustomization?: boolean;
}

export default function EventQRCode({
  eventId,
  eventName,
  allowCustomization = false,
}: EventQRCodeProps) {
  const [fgColor, setFgColor] = useState('#123851');

  const uploadUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/event/${eventId}/upload`;
  }, [eventId]);

  function handleDownloadPng() {
    const canvas = document.querySelector<HTMLCanvasElement>('#event-qr canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${eventName.replace(/\s+/g, '-').toLowerCase()}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  if (!uploadUrl) return null;

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-ink/10 bg-white p-6 text-center">
      <div id="event-qr" className="rounded-xl bg-white p-3">
        <QRCodeCanvas value={uploadUrl} size={220} fgColor={fgColor} includeMargin />
      </div>
      <p className="text-sm text-ink/70">
        Guests scan this code to upload photos to <strong>{eventName}</strong>.
      </p>
      <p className="break-all text-xs text-ink/50">{uploadUrl}</p>

      {allowCustomization ? (
        <label className="flex items-center gap-2 text-sm">
          QR color
          <input
            type="color"
            value={fgColor}
            onChange={(e) => setFgColor(e.target.value)}
            aria-label="QR code color"
          />
        </label>
      ) : null}

      <button
        type="button"
        onClick={handleDownloadPng}
        className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent/90"
      >
        Download QR code (PNG)
      </button>
    </div>
  );
}
