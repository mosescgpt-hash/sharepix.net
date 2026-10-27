import { FormEvent, useState } from 'react';
import { PIN_PATTERN } from '@/lib/galleryAccess';

interface GalleryPinPromptProps {
  /** Resolves with ok: true when the PIN was right and access was stored. */
  onSubmit: (pin: string) => Promise<{ ok: boolean; message: string; retryAfterSeconds?: number }>;
  /** Called after a right PIN, to load the gallery. */
  onUnlocked: () => void;
  /** 'the gallery' or 'the slideshow', for the heading. */
  what?: string;
  /** Dark background (the venue screen) rather than the canvas page. */
  dark?: boolean;
}

/**
 * Asks a guest for the gallery PIN. Digits only, numeric keypad on a phone, and
 * every control at least 44px tall. A wrong PIN says so without saying anything
 * about what the right one looks like.
 */
export default function GalleryPinPrompt({ onSubmit, onUnlocked, what = 'the gallery', dark = false }: GalleryPinPromptProps) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!PIN_PATTERN.test(pin)) {
      setMessage('Enter the 4 to 6 digit PIN the host gave you.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await onSubmit(pin);
      if (result.ok) {
        onUnlocked();
        return;
      }
      setMessage(result.message || 'That PIN is not right.');
      setPin('');
    } catch {
      setMessage('The PIN could not be checked. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className={`mx-auto w-full max-w-sm border p-6 ${
        dark ? 'border-canvas/20 bg-ink text-canvas' : 'border-charcoal/10 bg-paper text-charcoal'
      }`}
      aria-labelledby="gallery-pin-heading"
    >
      <h2 id="gallery-pin-heading" className="spx-display-serif text-2xl">
        Enter the PIN
      </h2>
      <p className={`mt-2 text-sm ${dark ? 'text-canvas/80' : 'text-charcoal/70'}`}>
        The host has put a PIN on {what}. You can find it on the table sign or ask them.
      </p>
      <label htmlFor="gallery-pin" className="mt-4 block text-sm font-medium">
        PIN
      </label>
      <input
        id="gallery-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="spx-input mt-1 min-h-[44px] text-lg tracking-[0.3em] text-charcoal"
        aria-describedby={message ? 'gallery-pin-message' : undefined}
      />
      {message ? (
        <p id="gallery-pin-message" role="alert" className={`mt-2 text-sm ${dark ? 'text-canvas' : 'text-red-700'}`}>
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className={`mt-4 min-h-[44px] w-full ${dark ? 'spx-btn-canvas' : 'spx-btn-ink'} disabled:opacity-50`}
      >
        {busy ? 'Checking…' : 'Open'}
      </button>
    </form>
  );
}
