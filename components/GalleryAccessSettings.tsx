import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import SwitchRow from '@/components/SwitchRow';
import {
  manageGalleryPin,
  setEventGalleryPinPolicy,
  setEventGuestDownloadsBlocked,
  setEventGuestViewBlocked,
} from '@/lib/api';
import {
  DEFAULT_PIN_AUTO_DAYS,
  MAX_PIN_AUTO_DAYS,
  MIN_PIN_AUTO_DAYS,
  PIN_PATTERN,
  pinAutoDaysOf,
  pinLinkPath,
  pinModeOf,
  pinRequired,
  pinStartsOn,
  type PinMode,
} from '@/lib/galleryAccess';
import { QREvent } from '@/lib/types';

interface GalleryAccessSettingsProps {
  event: QREvent;
  /** The fields that changed, to merge into the page's copy of the event. */
  onChange: (patch: Partial<QREvent>) => void;
}

const MODE_OPTIONS: { key: PinMode; label: string }[] = [
  { key: 'auto', label: 'After the event' },
  { key: 'on', label: 'Always on' },
  { key: 'off', label: 'Off' },
];

function longDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Who can look and who can download, and the optional gallery PIN. Everything
 * here saves the moment it is changed and can be changed again at any time.
 * Guests can always add photos whatever is chosen here.
 *
 * The PIN is never shown back: the server keeps only a scrambled copy, so to
 * make a link or a QR code with the PIN in it the host types it again and the
 * server confirms it matches.
 */
export default function GalleryAccessSettings({ event, onChange }: GalleryAccessSettingsProps) {
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [newPin, setNewPin] = useState('');
  const [linkPinInput, setLinkPinInput] = useState('');
  const [linkPin, setLinkPin] = useState<string | null>(null);
  const [daysDraft, setDaysDraft] = useState(String(pinAutoDaysOf(event.galleryPinAutoDays)));
  const [copied, setCopied] = useState<string | null>(null);

  const viewBlocked = event.guestViewBlocked === true;
  const downloadsBlocked = event.guestDownloadsBlocked === true;
  const mode = pinModeOf(event.galleryPinMode);
  const pinIsSet = event.galleryPinSet === true;
  const starts = pinStartsOn(event);
  const pinActive = pinRequired(event);

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

  function pinStatus(): string {
    if (!pinIsSet) return 'No PIN is set, so anyone with the link can open the gallery.';
    if (mode === 'off') return 'A PIN is saved but turned off. Anyone with the link can open the gallery.';
    if (mode === 'on') return 'The PIN is on. Guests enter it before they see anything.';
    if (pinActive) return 'The PIN switched on automatically. Guests enter it before they see anything.';
    return starts
      ? `The PIN switches on ${longDate(starts)}, ${pinAutoDaysOf(event.galleryPinAutoDays)} days after your event.`
      : 'The PIN switches on automatically after your event.';
  }

  async function savePin() {
    if (!PIN_PATTERN.test(newPin)) {
      setMessage({ text: 'A PIN is 4 to 6 digits.', ok: false });
      return;
    }
    await run(
      'pin',
      async () => {
        const result = await manageGalleryPin(event.id, 'set', newPin);
        if (!result.ok) throw new Error(result.message || 'The PIN could not be saved.');
        onChange({ galleryPinSet: true });
        setNewPin('');
        setLinkPin(null);
      },
      'PIN saved. Make a new link or QR code below so guests can skip the prompt.',
    );
  }

  async function makeLink() {
    if (!PIN_PATTERN.test(linkPinInput)) {
      setMessage({ text: 'Type the PIN you set: 4 to 6 digits.', ok: false });
      return;
    }
    await run(
      'link',
      async () => {
        const result = await manageGalleryPin(event.id, 'check', linkPinInput);
        if (!result.ok) throw new Error(result.message || 'That is not the PIN for this event.');
        setLinkPin(linkPinInput);
        setLinkPinInput('');
      },
      'Here is your link and QR code. Treat them like the PIN itself.',
    );
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const galleryLink = linkPin ? `${origin}${pinLinkPath(event.id, linkPin, 'gallery')}` : '';
  const liveLink = linkPin ? `${origin}${pinLinkPath(event.id, linkPin, 'live')}` : '';

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

      <div id="gallery-pin" className="scroll-mt-24 border border-charcoal/15 bg-paper p-4">
        <p className="text-sm font-medium text-charcoal">Gallery PIN</p>
        <p className="mt-0.5 text-xs text-charcoal/70">
          A 4 to 6 digit PIN guests enter before they see the gallery, the slideshow or the booth
          gallery. It does not stop anyone adding photos. Six digits is harder to guess.
        </p>
        <p className="mt-2 text-sm text-charcoal" role="status">
          {pinStatus()}
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="new-gallery-pin" className="block text-xs font-medium text-charcoal">
              {pinIsSet ? 'Change the PIN' : 'Set a PIN'}
            </label>
            <input
              id="new-gallery-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="spx-input mt-1 min-h-[44px] tracking-[0.3em]"
            />
          </div>
          <button
            type="button"
            disabled={busy || newPin.length < 4}
            onClick={() => void savePin()}
            className="min-h-[44px] border border-ink bg-ink px-5 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
          >
            {working === 'pin' ? 'Saving…' : pinIsSet ? 'Save new PIN' : 'Save PIN'}
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-charcoal">When the PIN applies</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup">
            {MODE_OPTIONS.map((option) => {
              const active = mode === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      'mode',
                      async () => {
                        await setEventGalleryPinPolicy(event.id, { mode: option.key });
                        onChange({ galleryPinMode: option.key === 'auto' ? null : option.key });
                      },
                      option.key === 'auto'
                        ? `The PIN will switch on ${pinAutoDaysOf(event.galleryPinAutoDays)} days after the event.`
                        : option.key === 'on'
                          ? 'The PIN is on now.'
                          : 'The PIN is off.',
                    )
                  }
                  className={`min-h-[44px] border px-4 py-2 text-sm transition disabled:opacity-50 ${
                    active
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-charcoal/25 text-charcoal hover:border-charcoal/60'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {mode === 'auto' ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="pin-auto-days" className="block text-xs font-medium text-charcoal">
                  Days after the event
                </label>
                <input
                  id="pin-auto-days"
                  type="number"
                  inputMode="numeric"
                  min={MIN_PIN_AUTO_DAYS}
                  max={MAX_PIN_AUTO_DAYS}
                  value={daysDraft}
                  onChange={(e) => setDaysDraft(e.target.value)}
                  className="spx-input mt-1 min-h-[44px] w-28"
                />
              </div>
              <button
                type="button"
                disabled={busy || Number(daysDraft) === pinAutoDaysOf(event.galleryPinAutoDays)}
                onClick={() => {
                  const days = pinAutoDaysOf(Number(daysDraft));
                  setDaysDraft(String(days));
                  void run(
                    'days',
                    async () => {
                      await setEventGalleryPinPolicy(event.id, { autoDays: days });
                      onChange({ galleryPinAutoDays: days });
                    },
                    `The PIN will switch on ${days} days after the event.`,
                  );
                }}
                className="min-h-[44px] border border-charcoal/25 px-5 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
              >
                Save
              </button>
              <p className="w-full text-xs text-charcoal/70">
                The usual is {DEFAULT_PIN_AUTO_DAYS} days: the gallery stays easy to open while
                everyone is sharing, then locks once it is just memories. It only applies once a PIN
                is set.
              </p>
            </div>
          ) : null}
        </fieldset>

        {pinIsSet ? (
          <div className="mt-4 border-t border-ink/10 pt-4">
            <p className="text-xs font-medium text-charcoal">Link or QR code with the PIN inside</p>
            <p className="mt-0.5 text-xs text-charcoal/70">
              Guests who scan it skip the PIN prompt. A link without it still asks for the PIN, so
              a forwarded link does not give the gallery away. You can make these any time, including
              after the PIN switches on.
            </p>
            {linkPin ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="shrink-0 self-start border border-charcoal/15 bg-paper p-3">
                    <QRCodeSVG value={galleryLink} size={176} fgColor="#123851" bgColor="#FFFFFF" level="M" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    {[
                      { id: 'gallery', label: 'Gallery link', value: galleryLink },
                      { id: 'live', label: 'Slideshow screen link', value: liveLink },
                    ].map((item) => (
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
                <button
                  type="button"
                  onClick={() => setLinkPin(null)}
                  className="min-h-[44px] text-sm text-charcoal/70 underline"
                >
                  Hide
                </button>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label htmlFor="link-gallery-pin" className="block text-xs font-medium text-charcoal">
                    Type the PIN to confirm it
                  </label>
                  <input
                    id="link-gallery-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={linkPinInput}
                    onChange={(e) => setLinkPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="spx-input mt-1 min-h-[44px] tracking-[0.3em]"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || linkPinInput.length < 4}
                  onClick={() => void makeLink()}
                  className="min-h-[44px] border border-charcoal/25 px-5 text-sm font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
                >
                  {working === 'link' ? 'Checking…' : 'Make link and QR code'}
                </button>
              </div>
            )}
            <p className="mt-3 text-xs text-charcoal/70">
              Forgotten the PIN? Set a new one above. Every link made with the old one stops working
              the moment you do.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  'clear',
                  async () => {
                    const result = await manageGalleryPin(event.id, 'clear');
                    if (!result.ok) throw new Error(result.message || 'The PIN could not be removed.');
                    onChange({ galleryPinSet: false });
                    setLinkPin(null);
                  },
                  'The PIN is removed.',
                )
              }
              className="mt-1 min-h-[44px] text-sm text-red-700 underline disabled:opacity-50"
            >
              Remove the PIN
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
