import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { QRCodeSVG } from 'qrcode.react';
import Notice from '@/components/Notice';
import { fetchEvent } from '@/lib/api';
import {
  BOOTH_CONSENT_TEXT,
  KIOSK_RESET_SECONDS,
  boothSmsConsentText,
  kioskStorageKey,
  parseKioskState,
  type KioskState,
} from '@/lib/booth';
import { checkContact, newPersonId, sealContact } from '@/lib/boothSeal';
import { boothLink } from '@/lib/boothLink';

/** SharePix's booth public key. Public by design; the private half is server-only. */
const PUBLIC_KEY = process.env.NEXT_PUBLIC_BOOTH_PUBLIC_KEY ?? '';

function readState(eventId: string): KioskState | null {
  try {
    return parseKioskState(window.localStorage.getItem(kioskStorageKey(eventId)));
  } catch {
    return null;
  }
}

function writeState(eventId: string, state: KioskState) {
  try {
    window.localStorage.setItem(kioskStorageKey(eventId), JSON.stringify(state));
  } catch {
    // Private mode: the kiosk still works, it just forgets the count.
  }
}

/**
 * Offline booth kiosk (docs/booth-mode.md, "Offline kiosk").
 *
 * Works with no signal once opened online once: the service worker keeps
 * this page and its scripts. The attendee types an email and/or cell number;
 * the kiosk encrypts them with SharePix's public key and shows the result as a
 * QR code. The photographer photographs the code, then the person. The
 * server finds the code in the uploaded photo and opens it — nobody else can,
 * and the host only ever sees a masked label.
 *
 * Nothing typed is stored: no localStorage, no IndexedDB, no cache. "Next
 * person" (or the timer) wipes the form and the code from memory. The kiosk
 * keeps only the event name, a count and random person ids.
 */
export default function BoothKioskPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : null;

  const [state, setState] = useState<KioskState | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'closed' | 'never-online'>('loading');
  const [online, setOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [emailConsent, setEmailConsent] = useState(false);
  const [smsConsent, setSmsConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(KIOSK_RESET_SECONDS);
  const firstInput = useRef<HTMLInputElement>(null);

  // Online/offline indicator.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Save this page and its scripts for offline use, then report whether it is.
  useEffect(() => {
    if (typeof caches === 'undefined' || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    const check = () =>
      caches
        .match(window.location.origin + window.location.pathname.replace(/\/$/, ''))
        .then((hit) => {
          if (!cancelled) setOfflineReady(Boolean(hit));
        })
        .catch(() => undefined);
    if (navigator.onLine) {
      navigator.serviceWorker.ready
        .then((reg) => {
          const scripts = performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .filter((u) => u.includes('/_next/static/'));
          reg.active?.postMessage({ type: 'save-kiosk', urls: [window.location.href, ...scripts] });
          window.setTimeout(check, 1500);
        })
        .catch(() => undefined);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [online, status]);

  // The event: from the network when there is one, else what this kiosk saw last.
  useEffect(() => {
    if (!eventId) return;
    const saved = readState(eventId);
    let cancelled = false;
    fetchEvent(eventId)
      .then((ev) => {
        if (cancelled) return;
        if (!ev || ev.boothMode !== true) {
          setStatus('closed');
          return;
        }
        const next: KioskState = { eventName: ev.name ?? '', count: saved?.count ?? 0, personIds: saved?.personIds ?? [] };
        writeState(eventId, next);
        setState(next);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        if (saved) {
          setState(saved);
          setStatus('ready');
        } else {
          setStatus('never-online');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const nextPerson = useCallback(() => {
    // Wipe everything typed, and the code that carries it.
    setEmail('');
    setPhone('');
    setEmailConsent(false);
    setSmsConsent(false);
    setError(null);
    setCode(null);
    setSecondsLeft(KIOSK_RESET_SECONDS);
    window.setTimeout(() => firstInput.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!code) return;
    if (secondsLeft <= 0) {
      nextPerson();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [code, secondsLeft, nextPerson]);

  async function makeCode() {
    if (!eventId || !state) return;
    setError(null);
    const checked = checkContact({ email, phone, smsConsent, emailConsent });
    if (!checked.ok) {
      setError(checked.reason);
      return;
    }
    setWorking(true);
    try {
      const personId = newPersonId();
      const sealed = await sealContact({ contact: checked.contact, eventId, personId, publicKey: PUBLIC_KEY });
      const next: KioskState = {
        ...state,
        count: state.count + 1,
        personIds: [...state.personIds, personId].slice(-5000),
      };
      writeState(eventId, next);
      setState(next);
      // The typed values are no longer needed: only the sealed code remains.
      setEmail('');
      setPhone('');
      // A sharepix.net link holding the sealed code: built here, no connection needed.
      setCode(boothLink(eventId, sealed));
      setSecondsLeft(KIOSK_RESET_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The code could not be made. Try again.');
    } finally {
      setWorking(false);
    }
  }

  const eventName = state?.eventName || 'this event';

  return (
    <>
      <Head>
        <title>{state?.eventName ? `${state.eventName} · Photo kiosk` : 'Photo kiosk'}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="min-h-screen bg-canvas px-4 py-6 text-charcoal">
        <div className="mx-auto w-full max-w-xl">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="spx-eyebrow">{state?.eventName || 'SharePix'}</span>
            <span className="flex items-center gap-3" aria-live="polite">
              <span className={online ? 'text-pine' : 'text-red-700'}>
                ● {online ? 'Online' : 'Offline — still working'}
              </span>
              <span className="text-charcoal/65">
                {offlineReady ? 'Saved for offline' : 'Not saved for offline yet'}
              </span>
              {state ? <span className="text-charcoal/65">{state.count} signed up here</span> : null}
            </span>
          </div>

          {!PUBLIC_KEY ? (
            <Notice tone="error" className="mt-6">
              The offline kiosk is not set up yet (no booth key). Use the regular sign-up page.
            </Notice>
          ) : status === 'loading' ? (
            <p className="mt-6 text-sm text-charcoal/70">Loading&hellip;</p>
          ) : status === 'closed' ? (
            <p className="spx-body mt-6">This event is not taking photo sign-ups.</p>
          ) : status === 'never-online' ? (
            <p className="spx-body mt-6">
              Open this page once with a connection so it can be saved for offline use.
            </p>
          ) : code ? (
            <div className="mt-6 text-center">
              <h1 className="spx-display text-3xl sm:text-4xl">Show this to the photographer</h1>
              <p className="spx-body mt-3">
                They take one photo of this code, then your photos. Your link arrives after the
                photographer approves them.
              </p>
              <div className="mx-auto mt-6 inline-block bg-white p-4">
                <QRCodeSVG value={code} size={360} level="M" aria-label="Your photo code" />
              </div>
              <p className="mt-4 text-sm text-charcoal/65">The screen clears in {secondsLeft} seconds.</p>
              <button type="button" onClick={nextPerson} className="spx-btn-ink mt-6 w-full text-lg sm:w-auto">
                Next person
              </button>
            </div>
          ) : (
            <>
              <h1 className="mt-4">
                <span className="spx-display block text-4xl">Get your photos</span>
                <span className="spx-display-serif block">sent to you.</span>
              </h1>
              <p className="spx-body mt-3">Enter an email, a cell number, or both.</p>
              <form
                className="mt-6 space-y-4"
                autoComplete="off"
                onSubmit={(e) => {
                  e.preventDefault();
                  void makeCode();
                }}
              >
                <label className="block">
                  <span className="text-sm font-medium">Email</span>
                  <input
                    ref={firstInput}
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                    maxLength={254}
                    className="spx-input mt-1 w-full"
                  />
                </label>
                {email.trim() ? (
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={emailConsent}
                      onChange={(e) => setEmailConsent(e.target.checked)}
                      className="mt-1"
                    />
                    <span>{BOOTH_CONSENT_TEXT}</span>
                  </label>
                ) : null}
                <label className="block">
                  <span className="text-sm font-medium">Cell number</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="off"
                    maxLength={20}
                    className="spx-input mt-1 w-full"
                  />
                </label>
                {phone.trim() ? (
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={smsConsent}
                      onChange={(e) => setSmsConsent(e.target.checked)}
                      className="mt-1"
                    />
                    <span>{boothSmsConsentText(eventName)}</span>
                  </label>
                ) : null}
                <p className="text-xs leading-relaxed text-charcoal/65">
                  Your details are locked inside your code; this screen does not keep them, and
                  the host sees only a masked version. Approved photos are sent through a private
                  link. Full-resolution files are removed 30 days after the event. Read our{' '}
                  <a href="/privacy" className="underline">
                    Privacy Policy
                  </a>
                  .
                </p>
                {error ? <Notice tone="error">{error}</Notice> : null}
                <button type="submit" disabled={working} className="spx-btn-ink w-full disabled:opacity-40">
                  {working ? 'Making your code…' : 'Get my code'}
                </button>
              </form>
            </>
          )}
        </div>
      </main>
    </>
  );
}
