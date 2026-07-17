import { useEffect, useMemo, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { createDownloadShare } from '@/lib/api';
import { DisplayPhoto, DownloadShare, QREvent } from '@/lib/types';
import { isVideoFilename } from '@/lib/validation';

interface DownloadShareBuilderProps {
  event: QREvent;
  photos: DisplayPhoto[];
}

export default function DownloadShareBuilder({ event, photos }: DownloadShareBuilderProps) {
  const approvedPhotos = useMemo(
    () => photos.filter((photo) => photo.approved !== false),
    [photos],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [share, setShare] = useState<DownloadShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSelected(new Set(approvedPhotos.map((photo) => photo.id)));
  }, [approvedPhotos]);

  const shareUrl = useMemo(() => {
    if (!share || typeof window === 'undefined') return '';
    return `${window.location.origin}/share/${share.id}`;
  }, [share]);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setShare(null);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      setShare(await createDownloadShare(event, [...selected]));
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

  if (approvedPhotos.length === 0) {
    return <p className="text-sm text-ink/60">Upload and approve media before creating a download QR code.</p>;
  }

  return (
    <div className="rounded-2xl border border-accent/30 bg-white p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Premium sharing</p>
          <h2 className="font-display text-2xl font-bold">Create a download QR code</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink/60">
            Choose exactly what recipients may download. A new QR code keeps this selection even if you change it later.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => { setSelected(new Set(approvedPhotos.map((photo) => photo.id))); setShare(null); }}
            className="rounded-full border border-ink/20 px-3 py-2 font-medium hover:border-accent"
          >
            Entire event
          </button>
          <button
            type="button"
            onClick={() => { setSelected(new Set()); setShare(null); }}
            className="rounded-full border border-ink/20 px-3 py-2 font-medium hover:border-accent"
          >
            Clear
          </button>
        </div>
      </div>

      <p className="mt-4 text-sm font-medium">{selected.size} of {approvedPhotos.length} selected</p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7">
        {approvedPhotos.map((photo) => {
          const checked = selected.has(photo.id);
          return (
            <button
              type="button"
              key={photo.id}
              onClick={() => toggle(photo.id)}
              aria-pressed={checked}
              className={`relative overflow-hidden rounded-lg border-2 ${checked ? 'border-accent' : 'border-transparent opacity-60'}`}
            >
              {isVideoFilename(photo.s3Key) ? (
                <video src={photo.url} muted preload="metadata" className="aspect-square w-full bg-black object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt="" className="aspect-square w-full object-cover" />
              )}
              <span className={`absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full border-2 border-white text-xs font-bold text-white ${checked ? 'bg-accent' : 'bg-black/40'}`}>
                {checked ? '✓' : ''}
              </span>
            </button>
          );
        })}
      </div>

      {error ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <button
        type="button"
        onClick={handleCreate}
        disabled={busy || selected.size === 0}
        className="mt-5 rounded-full bg-ink px-5 py-3 font-medium text-white hover:bg-night disabled:opacity-50"
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
            <p className="mt-1 text-sm text-ink/60">
              This link includes {share.photoIds.length} selected item{share.photoIds.length === 1 ? '' : 's'}.
            </p>
            <p className="mt-2 break-all text-xs text-ink/50">{shareUrl}</p>
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
