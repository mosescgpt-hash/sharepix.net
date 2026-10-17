import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { QRCodeSVG } from 'qrcode.react';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { boothSignUp, fetchEvent } from '@/lib/api';
import {
  BOOTH_CONSENT_TEXT,
  KIOSK_RESET_SECONDS,
  boothQrPayload,
  boothStorageKey,
} from '@/lib/booth';
import type { QREvent } from '@/lib/types';

type Saved = { token: string; name: string };

function readSaved(eventId: string): Saved | null {
  try {
    const raw = window.localStorage.getItem(boothStorageKey(eventId));
    const parsed = raw ? (JSON.parse(raw) as Saved) : null;
    return parsed?.token && parsed?.name ? parsed : null;
  } catch {
    return null;
  }
}

function writeSaved(eventId: string, saved: Saved | null) {
  try {
    if (saved) window.localStorage.setItem(boothStorageKey(eventId), JSON.stringify(saved));
    else window.localStorage.removeItem(boothStorageKey(eventId));
  } catch {
    // Private browsing: the code is still on screen, just not remembered.
  }
}

/**
 * Booth mode sign-up (docs/booth-mode.md).
 *
 * Two uses of one page. On an attendee's own phone it remembers their code, so
 * reopening the link shows it again. With `?kiosk=1` — a tablet or computer at
 * the booth — it remembers nothing, shows the code large for the photographer
 * to scan, and clears itself for the next person.
 */
export default function BoothSignupPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;
  const kiosk = router.query.kiosk === '1';

  const [event, setEvent] = useState<QREvent | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(KIOSK_RESET_SECONDS);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!eventId) return;
    fetchEvent(eventId)
      .then((ev) => setEvent(ev))
      .catch(() => setEvent(null));
    if (!kiosk) setSaved(readSaved(eventId));
  }, [eventId, kiosk]);

  const reset = useCallback(() => {
    setSaved(null);
    setName('');
    setEmail('');
    setConsent(false);
    setError(null);
    setSecondsLeft(KIOSK_RESET_SECONDS);
    nameInput.current?.focus();
  }, []);

  // The kiosk clears itself, so a code never sits on a shared screen.
  useEffect(() => {
    if (!kiosk || !saved) return;
    if (secondsLeft <= 0) {
      reset();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [kiosk, saved, secondsLeft, reset]);

  async function submit() {
    if (!eventId) return;
    setWorking(true);
    setError(null);
    try {
      const result = await boothSignUp({ eventId, name, email, consent });
      if (!result.ok || !result.token) {
        setError(result.message || 'Sign-up did not go through. Please try again.');
        return;
      }
      const next = { token: result.token, name: result.name ?? name.trim() };
      setSaved(next);
      setSecondsLeft(KIOSK_RESET_SECONDS);
      if (!kiosk) writeSaved(eventId, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up did not go through. Please try again.');
    } finally {
      setWorking(false);
    }
  }

  const unavailable = event === null || (event !== undefined && event.boothMode !== true);

  return (
    <Layout title={event?.name ? `${event.name} · Photo sign-up` : 'Photo sign-up'} noindex>
      <section className="spx-section-canvas">
        <div className={`mx-auto w-full ${kiosk ? 'max-w-xl' : 'max-w-md'}`}>
          <p className="spx-eyebrow">{event?.name ?? 'SharePix'}</p>

          {event === undefined ? (
            <p className="mt-6 text-sm text-charcoal/55">Loading&hellip;</p>
          ) : unavailable ? (
            <>
              <h1 className="spx-display mt-3 text-3xl">Sign-up is not open</h1>
              <p className="spx-body mt-4">
                This event is not taking photo sign-ups. Check the link with the photographer.
              </p>
            </>
          ) : saved ? (
            <div className="mt-3 text-center">
              <h1 className="spx-display text-3xl sm:text-4xl">
                {kiosk ? `You're set, ${saved.name}` : `Hi ${saved.name}`}
              </h1>
              <p className="spx-body mt-3">
                Show this code to the photographer before your photo. Your photos will be
                emailed to you.
              </p>
              <div className="mx-auto mt-6 inline-block bg-white p-4">
                <QRCodeSVG
                  value={boothQrPayload(saved.token)}
                  size={kiosk ? 320 : 240}
                  level="M"
                  aria-label="Your photo code"
                />
              </div>
              {kiosk ? (
                <>
                  <p className="mt-4 text-sm text-charcoal/65">
                    Want it on your phone? Take a photo of this code. The screen clears in{' '}
                    {secondsLeft} seconds.
                  </p>
                  <button type="button" onClick={reset} className="spx-btn-ink mt-6 w-full sm:w-auto">
                    Done — next person
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-4 text-sm text-charcoal/65">
                    Keep this page open, or come back to this link — it will show your code
                    again on this phone.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (eventId) writeSaved(eventId, null);
                      reset();
                    }}
                    className="mt-4 text-sm text-charcoal/60 underline"
                  >
                    Not {saved.name}? Sign up someone else
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <h1 className="mt-3">
                <span className={`spx-display block ${kiosk ? 'text-4xl' : ''}`}>Get your photos</span>
                <span className="spx-display-serif block">sent to you.</span>
              </h1>
              <p className="spx-body mt-4">
                Sign up once and you&apos;ll get a code. Show it to the photographer before
                your photo, and every shot of you is emailed to you at full resolution.
              </p>
              <form
                className="mt-6 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <label className="block">
                  <span className="text-sm font-medium">Your name</span>
                  <input
                    ref={nameInput}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete={kiosk ? 'off' : 'name'}
                    maxLength={80}
                    required
                    className="spx-input mt-1 w-full"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium">Email</span>
                  <input
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete={kiosk ? 'off' : 'email'}
                    required
                    className="spx-input mt-1 w-full"
                  />
                </label>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1"
                  />
                  <span>{BOOTH_CONSENT_TEXT}</span>
                </label>
                {error ? <Notice tone="error">{error}</Notice> : null}
                <button
                  type="submit"
                  disabled={working || !consent}
                  className="spx-btn-ink w-full disabled:opacity-40"
                >
                  {working ? 'Signing up…' : 'Get my code'}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}
