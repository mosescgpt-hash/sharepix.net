import { fetchAuthSession } from 'aws-amplify/auth';
import { authModeFor, getClient } from '@/lib/dataClient';
import {
  ID_ALPHABET,
  ID_LENGTH,
  MAX_AGE_MS,
  MAX_BATCH_CHARS,
  MAX_ENTRIES,
  scrubRoute,
  scrubText,
  supportCode,
  type LogCode,
  type LogDevice,
} from '@/lib/clientLogSchema';
import { withTimeout } from '@/lib/withTimeout';

/**
 * The browser end of the diagnostic log.
 *
 * It exists so that when an event has a problem, there is something to read
 * afterwards: which phone, which browser, whether it had a session, which step
 * failed. What it records is bounded by lib/clientLogSchema.ts, and what it
 * refuses to record is as important: no photos, no message text, no names or
 * emails, and never the part of a link after the #, which is the guest link key.
 *
 * ## Delivery, honestly
 *
 * Entries are batched and sent through the same Amplify data client as
 * everything else, so they need the same guest session as everything else. Two
 * consequences are deliberate:
 *
 * - A browser cannot send a signed AppSync request with `sendBeacon`, and the
 *   data client does not expose `keepalive`. So when the page is hidden the
 *   queue is written to localStorage synchronously (that is the part that is
 *   guaranteed) and a send is attempted straight after (that part is best
 *   effort). Whatever does not get out is sent on the next visit or when the
 *   connection returns.
 * - A phone that can never get a guest session cannot report that through this
 *   channel until it can. It is recorded locally and delivered later.
 *
 * ## Switching it off
 *
 * `spx_nolog` in localStorage, set by the control on the privacy page and in
 * the notice guests see, or the browser's Do Not Track setting. Both stop
 * recording entirely and delete anything already queued.
 */

const OPT_OUT_KEY = 'spx_nolog';
const DEVICE_KEY = 'spx_did';
const QUEUE_KEY = 'spx_logq';
/** Entries one page load may record, so a loop cannot fill the queue. */
const SESSION_CAP = 300;
/** Times one code-and-detail pair may repeat in a session before it is dropped. */
const REPEAT_CAP = 8;
/** What is held offline between visits. */
const QUEUE_CAP = 100;
const FLUSH_AT = 20;
const FLUSH_AFTER_MS = 15_000;

export interface Pending {
  /** When it happened, by this device's clock. Only ever differenced. */
  at: number;
  c: LogCode;
  r?: string;
  d?: string;
  n?: number;
  /** The event it belongs to, or '' for the account. */
  e: string;
  /** The session it was recorded in. */
  s: string;
}

let sessionId = '';
let currentEvent = '';
let pending: Pending[] = [];
let recorded = 0;
const repeats = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let failures = 0;
let retryAt = 0;
let started = false;
let memoryDeviceId = '';

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    const probe = '__spx_probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function randomId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let id = '';
  // 256 is not a multiple of 30, so the first few characters are very slightly
  // more likely. The id is a label, not a secret, so that is fine.
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return id;
}

/** Whether this person has turned logging off, here or in their browser. */
export function isLoggingOff(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (window.localStorage.getItem(OPT_OUT_KEY) === '1') return true;
  } catch {
    // Storage is blocked; nothing to read.
  }
  const dnt =
    (typeof navigator !== 'undefined' && (navigator as Navigator & { doNotTrack?: string }).doNotTrack) ||
    (window as Window & { doNotTrack?: string }).doNotTrack;
  return dnt === '1' || dnt === 'yes';
}

/** Turn logging off on this device and delete what it holds. */
export function turnLoggingOff(): void {
  pending = [];
  if (timer) clearTimeout(timer);
  timer = null;
  const store = storage();
  try {
    store?.setItem(OPT_OUT_KEY, '1');
    store?.removeItem(QUEUE_KEY);
    store?.removeItem(DEVICE_KEY);
  } catch {
    // Nothing more can be done.
  }
  memoryDeviceId = '';
}

/** Turn logging back on. */
export function turnLoggingOn(): void {
  try {
    storage()?.removeItem(OPT_OUT_KEY);
  } catch {
    // Nothing to remove.
  }
}

/** This device's random id, made on first use. Null when logging is off. */
export function getDeviceId(): string | null {
  if (isLoggingOff()) return null;
  const store = storage();
  if (store) {
    const existing = store.getItem(DEVICE_KEY);
    if (existing && /^[A-Z0-9]{20}$/.test(existing)) return existing;
    const made = randomId();
    try {
      store.setItem(DEVICE_KEY, made);
    } catch {
      // Falls through to the in-memory id.
    }
    return made;
  }
  memoryDeviceId ||= randomId();
  return memoryDeviceId;
}

/** The code a guest can read out, or null when logging is off. */
export function getSupportCode(): string | null {
  const id = getDeviceId();
  return id ? supportCode(id) : null;
}

/** The event id in a path, when the page is one of an event's. */
export function eventIdFromPath(path: string): string {
  const match = path.split('#')[0].match(/^\/(?:event|b|booth)\/([A-Za-z0-9-]{8,64})(?:[/?]|$)/);
  return match ? match[1] : '';
}

/** Tell the logger which event the page belongs to. Empty for none. */
export function setLogEvent(eventId: string | null | undefined): void {
  currentEvent = eventId ?? '';
}

function browserOf(ua: string): { b?: string; app?: string } {
  const major = (re: RegExp) => ua.match(re)?.[1];
  let app: string | undefined;
  if (/FBAN|FBAV|FB_IAB/.test(ua)) app = 'Facebook';
  else if (/Instagram/.test(ua)) app = 'Instagram';
  else if (/MicroMessenger/.test(ua)) app = 'WeChat';
  else if (/Snapchat/.test(ua)) app = 'Snapchat';
  else if (/musical_ly|BytedanceWebview|TikTok/.test(ua)) app = 'TikTok';
  else if (/LinkedInApp/.test(ua)) app = 'LinkedIn';
  else if (/Twitter/.test(ua)) app = 'Twitter';
  else if (/\bLine\//.test(ua)) app = 'Line';
  else if (/GSA\//.test(ua)) app = 'Google app';
  else if (/Android.*; wv\)/.test(ua)) app = 'Android WebView';

  const edge = major(/EdgA?\/(\d+)/);
  if (edge) return { b: `Edge ${edge}`, app };
  const crios = major(/CriOS\/(\d+)/);
  if (crios) return { b: `Chrome ${crios}`, app };
  const fxios = major(/FxiOS\/(\d+)/);
  if (fxios) return { b: `Firefox ${fxios}`, app };
  const firefox = major(/Firefox\/(\d+)/);
  if (firefox) return { b: `Firefox ${firefox}`, app };
  const samsung = major(/SamsungBrowser\/(\d+)/);
  if (samsung) return { b: `Samsung ${samsung}`, app };
  const chrome = major(/Chrome\/(\d+)/);
  if (chrome) return { b: `Chrome ${chrome}`, app };
  const safari = major(/Version\/(\d+)[\d.]*.*Safari/);
  if (safari) return { b: `Safari ${safari}`, app };
  return { b: undefined, app };
}

function osOf(ua: string): string | undefined {
  const ios = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_\d]*/);
  if (ios) return `iOS ${ios[1]}`;
  const android = ua.match(/Android (\d+)/);
  if (android) return `Android ${android[1]}`;
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return undefined;
}

/** What kind of device and browser this is. Nothing in it identifies a person. */
export function describeDevice(): LogDevice {
  if (typeof navigator === 'undefined') return {};
  const ua = navigator.userAgent || '';
  const { b, app } = browserOf(ua);
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return {
    b,
    os: osOf(ua),
    app,
    w: Math.round(window.innerWidth || 0),
    h: Math.round(window.innerHeight || 0),
    net: connection?.effectiveType,
    store: storage() !== null,
    pwa: standalone,
  };
}

function loadQueue(): Pending[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(QUEUE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const oldest = Date.now() - MAX_AGE_MS;
    return parsed.filter(
      (item: Pending) =>
        item && typeof item.at === 'number' && item.at > oldest && typeof item.c === 'string' && typeof item.e === 'string',
    );
  } catch {
    return [];
  }
}

function saveQueue(): void {
  const store = storage();
  if (!store) return;
  try {
    if (pending.length === 0) store.removeItem(QUEUE_KEY);
    else store.setItem(QUEUE_KEY, JSON.stringify(pending.slice(-QUEUE_CAP)));
  } catch {
    // A full or blocked store loses diagnostics, never the page.
  }
}

function scheduleFlush(): void {
  if (timer || typeof window === 'undefined') return;
  const wait = Math.max(FLUSH_AFTER_MS, retryAt - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void flushClientLog();
  }, wait);
}

/**
 * Record one thing that happened.
 *
 * Cheap and never throws. `detail` is cleaned before it is stored, so passing
 * an error message is safe; passing a URL records "[url]".
 */
export function logEvent(code: LogCode, detail?: string, n?: number, route?: string): void {
  try {
    if (isLoggingOff()) return;
    if (!sessionId) sessionId = randomId();
    if (recorded >= SESSION_CAP) return;
    const d = detail ? scrubText(detail) : undefined;
    const r =
      route !== undefined
        ? scrubRoute(route)
        : typeof window !== 'undefined'
          ? scrubRoute(window.location.pathname)
          : undefined;
    const key = `${code}|${d ?? ''}|${currentEvent}|${code === 'route_view' ? r : ''}`;
    const seen = repeats.get(key) ?? 0;
    if (seen >= REPEAT_CAP) return;
    repeats.set(key, seen + 1);
    recorded += 1;

    const entry: Pending = {
      at: Date.now(),
      c: code,
      e: currentEvent,
      s: sessionId,
      ...(d ? { d } : {}),
      ...(typeof n === 'number' && Number.isFinite(n) ? { n: Math.round(n) } : {}),
      ...(r ? { r } : {}),
    };
    pending.push(entry);
    if (pending.length >= FLUSH_AT) void flushClientLog();
    else scheduleFlush();
  } catch {
    // Logging must never be the thing that breaks a page.
  }
}

/** Record a route change, and move the logger to that route's event. */
export function logRouteView(asPath: string): void {
  setLogEvent(eventIdFromPath(asPath));
  logEvent('route_view', undefined, undefined, asPath);
}

interface Group {
  event: string;
  session: string;
  items: Pending[];
}

function groupPending(items: Pending[]): Group[] {
  const groups = new Map<string, Group>();
  for (const item of items) {
    const key = `${item.e}|${item.s}`;
    const group = groups.get(key) ?? { event: item.e, session: item.s, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** The JSON for one batch, shrunk until it is under what the function will read. */
export function buildBatchJson(
  deviceId: string,
  session: string,
  items: Pending[],
  device: LogDevice,
  now: number,
): { json: string; used: number } {
  let take = Math.min(MAX_ENTRIES, items.length);
  for (;;) {
    const slice = items.slice(0, take);
    const json = JSON.stringify({
      deviceId,
      sessionId: session,
      build: process.env.NEXT_PUBLIC_BUILD_ID || 'dev',
      device,
      entries: slice.map((item) => ({
        t: Math.max(0, now - item.at),
        c: item.c,
        ...(item.r ? { r: item.r } : {}),
        ...(item.d ? { d: item.d } : {}),
        ...(item.n !== undefined ? { n: item.n } : {}),
      })),
    });
    if (json.length <= MAX_BATCH_CHARS || take <= 1) return { json, used: take };
    take = Math.max(1, Math.floor(take / 2));
  }
}

/**
 * Send what is queued. Safe to call at any time and from anywhere: it does
 * nothing when logging is off, when the device is offline, when a send is
 * already running, or when a recent send failed and it is backing off.
 */
export async function flushClientLog(): Promise<void> {
  if (flushing || pending.length === 0) return;
  if (isLoggingOff()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    saveQueue();
    return;
  }
  if (Date.now() < retryAt) {
    scheduleFlush();
    return;
  }
  const deviceId = getDeviceId();
  if (!deviceId) return;

  flushing = true;
  try {
    const mode = await authModeFor();
    const device = describeDevice();
    for (const group of groupPending(pending)) {
      // The server stores an account-level batch only for a signed-in caller.
      // Sending one from a guest would be refused; keep it for after sign-in.
      if (!group.event && mode === 'identityPool') continue;
      let remaining = group.items;
      while (remaining.length > 0) {
        const { json, used } = buildBatchJson(deviceId, group.session, remaining, device, Date.now());
        const result = await withTimeout(
          getClient().mutations.recordClientLog(
            { eventId: group.event || undefined, batchJson: json },
            { authMode: mode },
          ),
          10_000,
        );
        if (result.errors?.length) throw new Error('log send refused');
        const sent = new Set(remaining.slice(0, used));
        pending = pending.filter((item) => !sent.has(item));
        remaining = remaining.slice(used);
      }
    }
    failures = 0;
    retryAt = 0;
  } catch {
    failures += 1;
    retryAt = Date.now() + Math.min(5 * 60_000, 15_000 * 2 ** Math.min(failures, 5));
    scheduleFlush();
  } finally {
    flushing = false;
    saveQueue();
  }
}

let sessionProbed = false;

/**
 * Whether this browser could get a guest session, and how long it took.
 *
 * A guest with no session cannot upload or view anything, and from the guest's
 * side it just looks like a spinner. This is the line that tells us it was that.
 * Once per page load, and only on an event's pages.
 */
export async function probeGuestSession(): Promise<void> {
  if (sessionProbed || isLoggingOff()) return;
  sessionProbed = true;
  const began = Date.now();
  try {
    const session = await withTimeout(fetchAuthSession(), 8_000);
    const took = Date.now() - began;
    if (session.credentials) {
      logEvent(
        took > 3_000 ? 'guest_session_slow' : 'guest_session_ok',
        session.tokens ? 'signed in' : 'guest',
        took,
      );
    } else {
      logEvent('guest_session_fail', 'no credentials', took);
    }
  } catch (error) {
    const name = error instanceof Error ? (error.name || 'Error') : 'Error';
    logEvent(
      name === 'TimeoutError' ? 'guest_session_slow' : 'guest_session_fail',
      name === 'TimeoutError' ? 'timeout' : name,
      Date.now() - began,
    );
  }
}

function onHidden(): void {
  saveQueue();
  void flushClientLog();
}

/**
 * Start listening. Idempotent; called once from _app. Loads whatever an earlier
 * visit could not send, and wires the page-hide and connectivity listeners.
 */
export function startClientLog(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (isLoggingOff()) return;
  sessionId = randomId();
  pending = [...loadQueue(), ...pending];

  window.addEventListener('pagehide', onHidden);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
  });
  window.addEventListener('offline', () => logEvent('net_offline'));
  window.addEventListener('online', () => {
    logEvent('net_online');
    retryAt = 0;
    void flushClientLog();
  });
  window.addEventListener('error', (event) => {
    // The message of a script error is the browser's wording; it is cleaned
    // like everything else. Cross-origin script errors carry none, which is
    // itself worth knowing.
    // ResizeObserver's loop notice is the browser being polite, not a fault.
    if (/ResizeObserver/.test(event.message ?? '')) return;
    logEvent('client_error', event.message || 'script error');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { name?: string; message?: string } | string | undefined;
    const text =
      typeof reason === 'string' ? reason : `${reason?.name ?? 'Error'}: ${reason?.message ?? ''}`;
    logEvent('client_error', `rejection ${text}`);
  });
  if (pending.length > 0) scheduleFlush();
}

/** For tests: forget everything held in memory. */
export function resetClientLogForTests(): void {
  pending = [];
  recorded = 0;
  repeats.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  flushing = false;
  failures = 0;
  retryAt = 0;
  started = false;
  sessionId = '';
  currentEvent = '';
  sessionProbed = false;
  memoryDeviceId = '';
}

/** For tests: what is waiting to be sent. */
export function pendingForTests(): Array<{ c: LogCode; r?: string; d?: string; n?: number; e: string }> {
  return pending.map(({ c, r, d, n, e }) => ({ c, r, d, n, e }));
}
