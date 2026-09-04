import { useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import Notice from '@/components/Notice';
import { createDownloadShare } from '@/lib/api';
import { DownloadShare, QREvent } from '@/lib/types';

interface DownloadShareBuilderProps {
  event: QREvent;
  /** Ids selected in the gallery below to include in the share. */
  selectedIds: string[];
  /** How many approved photos exist (for the "N of M" count). */
  approvedCount: number;
  onSelectAll: () => void;
  onClear: () => void;
}

export default function DownloadShareBuilder({
  event,
  selectedIds,
  approvedCount,
  onSelectAll,
  onClear,
}: DownloadShareBuilderProps) {
  const [share, setShare] = useState<DownloadShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shareUrl = useMemo(() => {
    if (!share || typeof window === 'undefined') return '';
    return `${window.location.origin}/share/${share.id}`;
  }, [share]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      setShare(await createDownloadShare(event, selectedIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The sharing QR code could not be created.');
    } finally {
      setBusy(false);
    }
  }

  function handleDownloadQr() {
    const canvas = document.querySelector<HTMLCanvasElement>('#download-share-qr canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${event.name.replace(/\s+/g, '-').toLowerCase()}-download-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (approvedCount === 0) {
    return (
      <p className="text-sm text-charcoal/60">
        Upload and approve media before creating a download QR code.
      </p>
    );
  }

  return (
    <div className="border border-charcoal/10 bg-paper p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="spx-eyebrow">Guest downloads</p>
          <h2 className="font-sans text-2xl font-bold tracking-[-0.02em]">Create a download QR code</h2>
          <p className="mt-1 max-w-2xl text-sm text-charcoal/60">
            Toggle photos in the gallery below to choose exactly what recipients may download,
            then create the code. A new QR keeps this selection even if you change it later.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => { onSelectAll(); setShare(null); }}
            className="border border-charcoal/25 px-3 py-2 font-medium text-charcoal transition hover:border-charcoal/60"
          >
            Entire event
          </button>
          <button
            type="button"
            onClick={() => { onClear(); setShare(null); }}
            className="border border-charcoal/25 px-3 py-2 font-medium text-charcoal transition hover:border-charcoal/60"
          >
            Clear
          </button>
        </div>
      </div>

      <p className="mt-4 text-sm font-medium">
        {selectedIds.length} of {approvedCount} selected
      </p>

      {error ? (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      ) : null}

      <button
        type="button"
        onClick={handleCreate}
        disabled={busy || selectedIds.length === 0}
        className="spx-btn-ink mt-5 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create sharing QR code'}
      </button>

      {share && shareUrl ? (
        <div className="mt-6 grid gap-5 bg-sand p-5 sm:grid-cols-[auto_1fr] sm:items-center">
          <div id="download-share-qr" className="mx-auto bg-paper p-2">
            <QRCodeCanvas value={shareUrl} size={190} includeMargin />
          </div>
          <div className="min-w-0">
            <h3 className="font-sans text-xl font-bold tracking-[-0.02em]">Download QR code ready</h3>
            <p className="mt-1 text-sm text-charcoal/60">
              This link includes {share.photoIds.length} selected item
              {share.photoIds.length === 1 ? '' : 's'}.
            </p>
            <p className="mt-2 break-all text-xs text-charcoal/60">{shareUrl}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={handleDownloadQr} className="bg-ink px-4 py-2 text-sm font-medium text-canvas transition hover:bg-night">
                Download QR (PNG)
              </button>
              <button type="button" onClick={handleCopy} className="border border-charcoal/25 px-4 py-2 text-sm font-medium text-charcoal transition hover:border-charcoal/60">
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
