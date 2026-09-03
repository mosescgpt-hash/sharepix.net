import { useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
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
      <p className="text-sm text-muted">
        Upload and approve media before creating a download QR code.
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Guest downloads</p>
          <h2 className="font-display text-2xl font-bold">Create a download QR code</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Toggle photos in the gallery below to choose exactly what recipients may download,
            then create the code. A new QR keeps this selection even if you change it later.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => { onSelectAll(); setShare(null); }}
            className="rounded-full border border-ink/20 px-3 py-2 font-medium hover:border-accent"
          >
            Entire event
          </button>
          <button
            type="button"
            onClick={() => { onClear(); setShare(null); }}
            className="rounded-full border border-ink/20 px-3 py-2 font-medium hover:border-accent"
          >
            Clear
          </button>
        </div>
      </div>

      <p className="mt-4 text-sm font-medium">
        {selectedIds.length} of {approvedCount} selected
      </p>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={handleCreate}
        disabled={busy || selectedIds.length === 0}
        className="mt-4 rounded-full bg-ink px-5 py-3 font-medium text-white hover:bg-night disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create sharing QR code'}
      </button>

      {share && shareUrl ? (
        <div className="mt-6 grid gap-5 rounded-xl bg-smoke p-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <div id="download-share-qr" className="mx-auto rounded-lg bg-white p-2">
            <QRCodeCanvas value={shareUrl} size={190} includeMargin />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-xl font-bold">Download QR code ready</h3>
            <p className="mt-1 text-sm text-muted">
              This link includes {share.photoIds.length} selected item
              {share.photoIds.length === 1 ? '' : 's'}.
            </p>
            <p className="mt-2 break-all text-xs text-muted">{shareUrl}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={handleDownloadQr} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white">
                Download QR (PNG)
              </button>
              <button type="button" onClick={handleCopy} className="rounded-full border border-ink/20 px-4 py-2 text-sm font-medium">
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
