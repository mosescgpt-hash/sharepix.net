/**
 * What a diagnostic log may contain, and how it is cleaned.
 *
 * The browser is the caller and nothing it sends is trusted. This file is the
 * vocabulary both ends agree on: the browser uses it to avoid recording what it
 * should not, and the recordClientLog function (which holds a byte-identical
 * copy below this header, pinned by __tests__/client-log-function-copy.test.ts)
 * uses it to refuse and clean whatever arrives anyway.
 *
 * ## What is never recorded
 *
 * No photo or video content, no guest-book or message text, no names, emails or
 * IP addresses, and never the guest link key, which lives after the # in a
 * link. Every free-text field passes through scrubText, which removes URLs,
 * emails and anything shaped like a token or a signed-URL parameter.
 */

/** Longest a stored detail may be, after cleaning. */
export const MAX_DETAIL = 120;
/** Longest a stored route may be, after cleaning. */
export const MAX_ROUTE = 80;
/** Entries accepted in one batch. */
export const MAX_ENTRIES = 25;
/** The serialized batch the function will read at all, in characters. */
export const MAX_BATCH_CHARS = 9000;
/** Oldest an entry may claim to be: a week, the offline queue's limit. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Days a stored batch lives before DynamoDB removes it. */
export const LOG_RETENTION_DAYS = 60;

/**
 * Every code a log entry may carry.
 *
 * An unknown code is dropped by the function, so the table cannot become a
 * free-text sink and a browser cannot invent events that look like the app's.
 * `level` is what the host-facing viewer highlights.
 */
export const LOG_CODES = {
  // Where the person went.
  route_view: 'info',
  // Their connection to SharePix.
  net_offline: 'warn',
  net_online: 'info',
  guest_session_ok: 'info',
  guest_session_fail: 'error',
  guest_session_slow: 'warn',
  // Uploading.
  upload_start: 'info',
  upload_retry: 'warn',
  upload_fail: 'error',
  upload_ok: 'info',
  // The live slideshow.
  live_start: 'info',
  live_start_fail: 'error',
  live_poll_fail: 'warn',
  live_poll_recovered: 'info',
  live_frame_unsignable: 'warn',
  live_paused: 'info',
  live_fullscreen: 'info',
  media_fallback: 'warn',
  // A host's My Events page.
  myevents_timeout: 'error',
  myevents_fail: 'error',
  // Anything the browser reported that nothing above covers.
  client_error: 'error',
} as const;

export type LogCode = keyof typeof LOG_CODES;
export type LogLevel = (typeof LOG_CODES)[LogCode];

export function isLogCode(value: unknown): value is LogCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOG_CODES, value);
}

/** One thing that happened, as the browser reports it. */
export interface LogEntry {
  /**
   * How many milliseconds before the batch was sent this happened. An age, not
   * a time: the server subtracts it from when it received the batch, so a
   * phone with the wrong date still lines up.
   */
  t: number;
  c: LogCode;
  /** The page, with ids replaced. */
  r?: string;
  /** A short cleaned note. */
  d?: string;
  /** One number that goes with the code: an attempt, a duration, a count. */
  n?: number;
}

/** The facts about a device that explain most problems, none identifying. */
export interface LogDevice {
  /** Browser family and major version, e.g. "Safari 17". */
  b?: string;
  /** Operating system and major version, e.g. "iOS 17". */
  os?: string;
  /** An in-app browser, when there is one: Facebook, Instagram, and so on. */
  app?: string;
  /** Screen width and height in CSS pixels. */
  w?: number;
  h?: number;
  /** The connection type the browser reports, e.g. "4g". */
  net?: string;
  /** Whether the browser let us keep anything between visits. */
  store?: boolean;
  /** Whether the page was installed to the home screen. */
  pwa?: boolean;
}

export interface LogBatch {
  /** A random per-device id; the first eight characters are the support code. */
  deviceId: string;
  sessionId: string;
  /** The deployed commit the page was built from. */
  build?: string;
  device?: LogDevice;
  entries: LogEntry[];
}

/** No 0, O, 1, I or L: a code read aloud over the phone survives. */
export const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const ID_LENGTH = 20;
const ID_PATTERN = /^[A-HJKMNP-TV-Z2-9]{20}$/;

export function isLogId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** The short code a guest can read out: the first eight characters, as XXXX-XXXX. */
export function supportCode(deviceId: string): string {
  const head = deviceId.slice(0, 8);
  return `${head.slice(0, 4)}-${head.slice(4)}`;
}

/** Turn what a person typed back into the characters it stands for. */
export function normalizeSupportCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]*/gi;
const EMAIL_PATTERN = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;
const SIGNED_PARAM_PATTERN =
  /\b(?:x-amz-[a-z-]+|signature|sig|token|key|k|access_token|id_token|policy|credential)=[^\s&"'<>]*/gi;
const AWS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g;
const LONG_TOKEN_PATTERN = /[A-Za-z0-9_\-+/=.]{24,}/g;

/**
 * Clean a free-text note so it cannot carry a secret or a person.
 *
 * Removal rather than masking where it matters: a URL becomes "[url]" with no
 * host, a fragment is cut wherever it appears, and any unbroken run of 24 or
 * more token-like characters (a guest link key, a JWT, a signature, a UUID
 * with its dashes) becomes "[token]".
 */
export function scrubText(value: unknown, max: number = MAX_DETAIL): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(URL_PATTERN, '[url]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(SIGNED_PARAM_PATTERN, '[param]')
    .replace(AWS_KEY_PATTERN, '[token]')
    // A fragment is where the guest link key lives. Whatever follows a # in a
    // note is cut, URL or not.
    .replace(/#\S*/g, '')
    .replace(LONG_TOKEN_PATTERN, '[token]')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, max);
}

/**
 * A page address reduced to its shape.
 *
 * Only the path survives: no query string, no fragment (the guest link key is
 * there), and any segment that looks like an id becomes ":id" so a route says
 * "the live slideshow" rather than "this person's event".
 */
export function scrubRoute(value: unknown): string {
  if (typeof value !== 'string') return '';
  const path = value.split('#')[0].split('?')[0].replace(URL_PATTERN, '');
  const segments = path
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      if (segment.length >= 12 && /[0-9]/.test(segment) && /^[A-Za-z0-9_-]+$/.test(segment)) {
        return ':id';
      }
      // A dynamic segment still in its template form, e.g. "[eventId]".
      if (/^\[[A-Za-z]+\]$/.test(segment)) return ':id';
      return segment.replace(/[^A-Za-z0-9_.~-]/g, '').slice(0, 32);
    })
    .join('/');
  const rooted = segments.startsWith('/') ? segments : `/${segments}`;
  return rooted.slice(0, MAX_ROUTE);
}

/** Clamp a number the browser sent into something storable. */
function cleanNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function cleanLabel(value: unknown, max = 24): string | undefined {
  const label = scrubText(value, max);
  return label || undefined;
}

export function cleanDevice(raw: unknown): LogDevice | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const device: LogDevice = {};
  const b = cleanLabel(r.b);
  const os = cleanLabel(r.os);
  const app = cleanLabel(r.app);
  const net = cleanLabel(r.net, 8);
  if (b) device.b = b;
  if (os) device.os = os;
  if (app) device.app = app;
  if (net) device.net = net;
  const w = cleanNumber(r.w, 0, 10000);
  const h = cleanNumber(r.h, 0, 10000);
  if (w !== undefined) device.w = w;
  if (h !== undefined) device.h = h;
  if (typeof r.store === 'boolean') device.store = r.store;
  if (typeof r.pwa === 'boolean') device.pwa = r.pwa;
  return Object.keys(device).length ? device : undefined;
}

/**
 * Check and clean one batch, or refuse it.
 *
 * Returns null for anything that is not a well-formed batch from a device with
 * a well-formed id. Entries with an unknown code are dropped one by one; a
 * batch with none left is refused. Everything that survives has been through
 * scrubText or scrubRoute, so what is stored is not what was sent.
 */
export function sanitizeBatch(json: unknown): LogBatch | null {
  if (typeof json !== 'string' || json.length === 0 || json.length > MAX_BATCH_CHARS) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isLogId(r.deviceId) || !isLogId(r.sessionId)) return null;
  if (!Array.isArray(r.entries)) return null;

  const entries: LogEntry[] = [];
  for (const item of r.entries.slice(0, MAX_ENTRIES)) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (!isLogCode(e.c)) continue;
    const entry: LogEntry = { t: cleanNumber(e.t, 0, MAX_AGE_MS) ?? 0, c: e.c };
    const route = scrubRoute(e.r);
    if (route) entry.r = route;
    const detail = scrubText(e.d);
    if (detail) entry.d = detail;
    const n = cleanNumber(e.n, -1_000_000, 1_000_000_000);
    if (n !== undefined) entry.n = n;
    entries.push(entry);
  }
  if (entries.length === 0) return null;

  const batch: LogBatch = { deviceId: r.deviceId, sessionId: r.sessionId, entries };
  // A build is a commit hash or a short label. Anything else is not one.
  if (typeof r.build === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(r.build)) batch.build = r.build;
  const device = cleanDevice(r.device);
  if (device) batch.device = device;
  return batch;
}

/** How many entries in a batch say something went wrong. */
export function problemCount(entries: LogEntry[]): number {
  return entries.filter((entry) => LOG_CODES[entry.c] !== 'info').length;
}
