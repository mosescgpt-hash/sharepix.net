import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import SwitchRow from '@/components/SwitchRow';
import {
  manageGalleryLink,
  setEventGuestDownloadsBlocked,
  setEventGuestViewBlocked,
  setEventSharingPaused,
} from '@/lib/api';
import { guestLinkPath } from '@/lib/galleryAccess';
import { QREvent } from '@/lib/types';

interface GalleryAccessSettingsProps {
  event: QREvent;
  /** The fields that changed, to merge into the page's copy of the event. */
  onChange: (patch: Partial<QREvent>) => void;
}

/**
 * Who can look and who can download, "Pause sharing", and "Replace QR code".
 * Everything here saves the moment it is changed and can be changed again at
 * any time. Guests can always add photos whatever is chosen here.
 *
 * Replacing the QR code makes a new secret in the links and stops every older
 * QR code and link opening the gallery, slideshow and downloads. Printed signs
 * carry the old one, so the host is warned before it happens and again after.
 */
export default function GalleryAccessSettings({ event, onChange }: GalleryAccessSettingsProps) {
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The current guest link key, once fetched or made. Null until then.
  const [linkKey, setLinkKey] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const viewBlocked = event.guestViewBlocked === true;
  const downloadsBlocked = event.guestDownloadsBlocked === true;
  const paused = event.sharingPaused === true;
  const hasKey = event.galleryLinkSet === true;

  async function run(key: string, action: () => Promise<void>, success: string) {
    setWorking(key);
    setMessage(null);
    try {
      await action();
      setMessage({ text: success, ok: true });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'That could not be saved.', ok: false });
    } finally {
      setWorking(null);
    }
  }

  const busy = working !== null;

  async function replaceQr() {
    setConfirming(false);
    await run(
      'rotate',
      async () => {
        const result = await manageGalleryLink(event.id, 'rotate');
        if (!result.ok || !result.linkKey) throw new Error(result.message || 'The QR code could not be replaced.');
        setLinkKey(result.linkKey);
        setReplaced(true);
        onChange({ galleryLinkSet: true, linkRotatedAt: result.rotatedAt });
      },
      'Done. The old QR code and links no longer work.',
    );
  }

  async function showCurrent() {
    await run(
      'get',
      async () => {
        const result = await manageGalleryLink(event.id, 'get');
        if (!result.ok || !result.linkKey) throw new Error(result.message || 'The current QR code could not be loaded.');
        setLinkKey(result.linkKey);
      },
      'Here is the current QR code.',
    );
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const links = linkKey
    ? [
        { id: 'upload', label: 'Guest QR code link (add photos)', value: `${origin}${guestLinkPath(event.id, linkKey, 'upload')}` },
        { id: 'gallery', label: 'Gallery link', value: `${origin}${guestLinkPath(event.id, linkKey, 'gallery')}` },
        { id: 'live', label: 'Slideshow screen link', value: `${origin}${guestLinkPath(event.id, linkKey, 'live')}` },
      ]
    : [];

  async function copy(which: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setMessage({ text: 'Copying was blocked. Select the link and copy it by hand.', ok: false });
    }
  }

  return (
    <div className="space-y-3 border-t border-ink/10 pt-4">
      <div id="gallery-access">
        <p className="text-sm font-medium">What guests can do</p>
        <p className="text-xs text-charcoal/70">
          Guests can always add photos and videos. You choose whether they can look and whether they
          can download. Change these any time.
        </p>
      </div>

      <p
        id="gallery-access-note"
        className="border-l-2 border-mint bg-sage/40 px-3 py-2 text-xs text-charcoal/80"
      >
        <strong className="font-medium text-charcoal">Pause sharing</strong> closes the gallery and
        downloads for guests straight away; they can still add photos.{' '}
        <strong className="font-medium text-charcoal">Replace QR code</strong> makes a new code and
        link and stops the old ones working, which helps if a link got out. You will need to reprint
        any signs that carry the old code.
      </p>

      <SwitchRow
        label="Pause sharing"
        description={
          paused
            ? 'Paused. Guests cannot see the gallery or slideshow or download anything, including through download links. They can still add photos. You still see everything.'
            : 'Off. Turn on to close the gallery and downloads to guests right now. Turn it off to open them again exactly as before.'
        }
        checked={paused}
        disabled={busy}
        onChange={(next) =>
          void run(
            'pause',
            async () => {
              await setEventSharingPaused(event.id, next);
              onChange({ sharingPaused: next });
            },
            next
              ? 'Sharing is paused. Guests can add photos but cannot view or download.'
              : 'Sharing is back on.',
          )
        }
      />

      <SwitchRow
        label="Guests can view the gallery"
        description={
          viewBlocked
            ? 'Off. Guests add photos and never see the gallery, the slideshow or the booth gallery. Everything comes straight to you.'
            : 'On. Guests see the gallery, within the “who can see” choice under Look.'
        }
        checked={!viewBlocked}
        disabled={busy}
        onChange={(next) =>
          void run(
            'view',
            async () => {
              await setEventGuestViewBlocked(event.id, !next);
              onChange({ guestViewBlocked: !next });
            },
            next ? 'Guests can view the gallery.' : 'Guests can no longer view the gallery. You still see everything.',
          )
        }
      />

      <SwitchRow
        label="Guests can download"
        description={
          downloadsBlocked
            ? 'Off. Guests see smaller viewing copies and no download or ZIP. You still have everything at full size. This cannot stop a screenshot.'
            : 'On. Guests can save photos and videos at full size, and download a ZIP, with no account.'
        }
        checked={!downloadsBlocked}
        disabled={busy}
        onChange={(next) =>
          void run(
            'download',
            async () => {
              await setEventGuestDownloadsBlocked(event.id, !next);
              onChange({ guestDownloadsBlocked: !next });
            },
            next ? 'Guests can download again.' : 'Guests can view but not download.',
          )
        }
      />

      <div id="replace-qr" className="scroll-mt-24 border border-charcoal/15 bg-paper p-4">
        <p className="text-sm font-medium text-charcoal">Replace QR code</p>
        <p className="mt-0.5 text-xs text-charcoal/70">
          Makes a new guest QR code and link. Anyone with an old QR code or link can still add
          photos, but can no longer open the gallery, the slideshow or download links.
        </p>
        <p className="mt-2 text-sm text-charcoal" role="status">
          {hasKey
            ? 'The QR code has been replaced. Only the newest one opens the gallery.'
            : 'The QR code has not been replaced. Every link and QR code for this event still works.'}
        </p>

        {confirming ? (
          <div role="alertdialog" aria-labelledby="replace-qr-warning" className="mt-3 border border-amber-500/60 bg-amber-50 p-4">
            <p id="replace-qr-warning" className="text-sm font-medium text-charcoal">
              Replace the QR code?
            </p>
            <p className="mt-1 text-sm text-charcoal/80">
              Every QR code and link you have already shared stops opening the gallery, including
              printed signs, table tents and download links you sent. You will need to reprint
              anything that carries the old code.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void replaceQr()}
                className="min-h-[44px] border border-ink bg-ink px-5 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
              >
                Yes, replace it
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="min-h-[44px] border border-charcoal/25 px-5 text-sm font-medium text-charcoal hover:border-charcoal/60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="min-h-[44px] border border-ink bg-ink px-5 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
            >
              {working === 'rotate' ? 'Replacing…' : 'Replace QR code'}
            </button>
            {hasKey && !linkKey ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void showCurrent()}
                className="min-h-[44px] border border-charcoal/25 px-5 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
              >
                {working === 'get' ? 'Loading…' : 'Show current QR code and links'}
              </button>
            ) : null}
          </div>
        )}

        {linkKey ? (
          <div className="mt-4 space-y-3 border-t border-ink/10 pt-4">
            {replaced ? (
              <p role="alert" className="text-sm font-medium text-red-700">
                Reprint your signs. Printed QR codes made before now no longer open the gallery. The
                sign maker, table tent and brochure pages already use the new code.
              </p>
            ) : null}
            <div className="flex flex-col gap-4 sm:flex-row">
              <div className="shrink-0 self-start border border-charcoal/15 bg-paper p-3">
                <QRCodeSVG value={links[0].value} size={176} fgColor="#123851" bgColor="#FFFFFF" level="M" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                {links.map((item) => (
                  <div key={item.id}>
                    <p className="text-xs font-medium text-charcoal">{item.label}</p>
                    <div className="mt-1 flex gap-2">
                      <input
                        readOnly
                        value={item.value}
                        onFocus={(e) => e.currentTarget.select()}
                        aria-label={item.label}
                        className="spx-input min-h-[44px] min-w-0 flex-1 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void copy(item.id, item.value)}
                        className="min-h-[44px] shrink-0 border border-charcoal/25 px-4 text-sm font-medium text-charcoal hover:border-charcoal/60"
                      >
                        {copied === item.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-xs text-charcoal/70">
              Treat these like a key: anyone who has them can open the gallery.
            </p>
            <button
              type="button"
              onClick={() => {
                setLinkKey(null);
                setReplaced(false);
              }}
              className="min-h-[44px] text-sm text-charcoal/70 underline"
            >
              Hide
            </button>
          </div>
        ) : null}
      </div>

      {message ? (
        <p role="status" className={`text-sm ${message.ok ? 'text-pine' : 'text-red-700'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
