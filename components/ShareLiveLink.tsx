import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useGuestLinkKey } from '@/lib/useGuestLinkKey';
import { liveLinkPath, liveLinkUrl, mailtoLiveLink } from '@/lib/liveView';

interface ShareLiveLinkProps {
  eventId: string;
  eventName: string;
  /** Tighter layout for a header row. */
  compact?: boolean;
}

/**
 * The host's shortcut to the live slideshow: open it here, or send it to
 * another screen (copy, native share, email to myself, or scan a QR code with
 * the phone and open it on a computer or TV).
 *
 * The link is built with the event's current QR-code key when the host has
 * replaced the QR code, so it still works for whoever opens it. Show this only
 * when the event has the live slideshow (liveSlideshowAvailable).
 */
export default function ShareLiveLink({ eventId, eventName, compact = false }: ShareLiveLinkProps) {
  const { key, ready } = useGuestLinkKey(eventId, true);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const url = origin && ready ? liveLinkUrl(origin, eventId, key) : '';

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied('done');
    } catch {
      // Clipboard blocked (older Safari, an in-app browser): the field below is
      // selectable, so say so rather than fail quietly.
      setCopied('failed');
    }
    window.setTimeout(() => setCopied('idle'), 3000);
  }

  async function share() {
    if (!url) return;
    try {
      await navigator.share({ title: `${eventName} — live slideshow`, url });
    } catch {
      // Cancelled by the person, or refused: nothing to undo.
    }
  }

  return (
    <div className={compact ? '' : 'border border-charcoal/15 bg-white p-4'}>
      <div className="flex flex-wrap gap-2">
        <a
          href={liveLinkPath(eventId, key)}
          target="_blank"
          rel="noopener noreferrer"
          className="spx-btn-ink"
        >
          Open live slideshow
        </a>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="spx-btn-outline"
        >
          Share live link
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-3" data-testid="share-live-panel">
          <p className="text-sm text-charcoal/70">
            Open this link on a computer or TV to run the slideshow there. It shows one photo at a
            time and new photos appear on their own.
          </p>
          <input
            readOnly
            aria-label="Live slideshow link"
            value={url || 'Preparing link…'}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full border border-charcoal/25 bg-white px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} disabled={!url} className="spx-btn-ink disabled:opacity-50">
              {copied === 'done' ? 'Copied' : 'Copy link'}
            </button>
            {canShare ? (
              <button type="button" onClick={() => void share()} disabled={!url} className="spx-btn-outline disabled:opacity-50">
                Share…
              </button>
            ) : null}
            {url ? (
              <a href={mailtoLiveLink(eventName, url)} className="spx-btn-outline">
                Email it to myself
              </a>
            ) : null}
          </div>
          {copied === 'failed' ? (
            <p className="text-sm text-red-700">Could not copy automatically. Tap the link above and copy it.</p>
          ) : null}
          {url ? (
            <div className="flex items-center gap-4">
              <div className="bg-white p-2">
                <QRCodeSVG value={url} size={132} />
              </div>
              <p className="text-sm text-charcoal/70">
                Scan with a phone or tablet to open the live slideshow on it.
              </p>
            </div>
          ) : null}
          <p className="text-xs text-charcoal/60">
            If you replace the QR code later, share this link again so it keeps working.
          </p>
        </div>
      ) : null}
    </div>
  );
}
