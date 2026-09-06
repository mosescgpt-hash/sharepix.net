/**
 * The "your gallery closes soon" email, as pure string assembly.
 *
 * Separated from the sending so the wording, the escaping and the MIME
 * structure can be tested without an SES call — the same reason
 * create-event-photo/alert-email.ts is its own file.
 *
 * The tone is the point. This message tells someone their wedding photos are
 * going to stop existing, so it says the date plainly, says what to do about
 * it in one sentence, and does not try to sell anything. A host who reads it
 * and downloads their photos is the successful outcome, even though it earns
 * nothing.
 */

/** Gallery retention in days per tier, from when the upload window closes. */
export const RETENTION_DAYS_BY_TIER: Record<string, number> = {
  // On sale.
  plus: 365,
  free: 30,
  // Retired, at what they were sold with.
  event: 365,
  starter: 21,
  standard: 90,
  premium: 365,
  // Corporate events are covered by a subscription rather than a plan row.
  corporate: 365,
};

/** Mirrors eventLifecycle's fallback in lib/lifecycle.ts for an unknown tier. */
export const DEFAULT_RETENTION_DAYS = 90;

export function retentionDaysForTier(tier: string | null | undefined): number {
  const id = (tier ?? '').trim().toLowerCase();
  return RETENTION_DAYS_BY_TIER[id] ?? DEFAULT_RETENTION_DAYS;
}

/**
 * When an event's gallery closes: the upload window's end plus the plan's
 * retention, which is exactly what `eventLifecycle().retentionEndsAt` computes.
 *
 * Derived from `uploadWindowEndsAt` rather than read from `accessExpiresAt`,
 * even though the two agree for a new event on a current plan. They diverge the
 * moment a host buys an upload-window extension — that moves the window and
 * everything after it, and does not touch accessExpiresAt — so using the stored
 * field would warn a host about a date that had already moved.
 *
 * Null for an event with no window at all (created before the lifecycle model).
 * Those never expire, so there is nothing to warn about.
 */
export function galleryExpiresAt(
  uploadWindowEndsAt: string | null | undefined,
  tier: string | null | undefined,
): Date | null {
  if (!uploadWindowEndsAt) return null;
  const windowEnd = Date.parse(uploadWindowEndsAt);
  if (!Number.isFinite(windowEnd)) return null;
  return new Date(windowEnd + retentionDaysForTier(tier) * 24 * 60 * 60 * 1000);
}

/** Escape text interpolated into the HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Make a value safe for a MIME header.
 *
 * Event names come from the host, and a CR or LF inside one would let the value
 * inject extra headers — a forged From, an extra Bcc. Mirrors
 * sanitizeHeaderValue in create-event-photo/alert-email.ts.
 */
export function sanitizeHeaderValue(value: string, maxLength = 120): string {
  // A character scan, not a regex. A control-character class written inline is
  // the single most reliably mis-escaped thing in this codebase — it has been
  // written wrong, and silently embedded literal control bytes in the source,
  // more than once. This cannot be got wrong by a text editor.
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) {
      out += ' ';
      continue;
    }
    out += char;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export interface ExpiryMessageInput {
  eventName: string;
  /** Formatted for a human: "14 March 2027". */
  expiresOn: string;
  daysRemaining: number;
  /** Where the host downloads. Must be one of our own https URLs. */
  galleryUrl: string;
  /** Whether this plan can buy more time. False on the free trial. */
  canExtend: boolean;
}

export interface BuiltMessage {
  subject: string;
  html: string;
  text: string;
}

/**
 * The only host an emailed link may point at.
 *
 * Pinned to our own domain rather than "any https URL", which is what this
 * check first said and is not a check at all: `https://evil.example.com/...`
 * passed it. The URL is assembled from APP_URL, so the realistic way a bad one
 * gets here is a misconfigured environment variable rather than an attack —
 * but the consequence is a SharePix-branded email pointing somewhere else, sent
 * to every host with an expiring gallery, and that is worth being strict about.
 *
 * A subdomain is allowed (`www.`), a lookalike is not (`sharepix.net.evil.com`
 * fails because the match is anchored at the end of the host).
 */
const APP_HOST = /^([a-z0-9-]+\.)*sharepix\.net$/i;

export function isSafeAppUrl(url: string): boolean {
  if (!/^https:\/\/[a-z0-9.-]+(\/[a-z0-9/_-]*)?(\?[a-z0-9=&_-]*)?$/i.test(url)) return false;
  const host = url.slice('https://'.length).split(/[/?]/)[0];
  return APP_HOST.test(host);
}

export function buildExpiryMessage(input: ExpiryMessageInput): BuiltMessage {
  const name = sanitizeHeaderValue(input.eventName || 'Your event');
  const url = isSafeAppUrl(input.galleryUrl) ? input.galleryUrl : '';
  const days = Math.max(0, Math.round(input.daysRemaining));

  // The subject carries the number because that is what makes someone open it,
  // and the body carries the date because that is what they need to act on.
  const subject =
    days <= 7
      ? `Last chance: ${name} photos are deleted in ${days} day${days === 1 ? '' : 's'}`
      : `${name}: your gallery closes in ${days} days`;

  const action = url
    ? 'Open your gallery and download everything you want to keep.'
    : 'Sign in to SharePix and download everything you want to keep.';
  const extend = input.canExtend
    ? ''
    : ' A free event cannot be extended, so downloading is the way to keep these.';

  const text = [
    `Your SharePix gallery for ${name} closes on ${input.expiresOn}.`,
    '',
    `After that the photos are archived and then permanently deleted. ${action}${extend}`,
    '',
    url ? url : '',
    '',
    'SharePix LLC',
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');

  const html = [
    '<!doctype html><html><body style="margin:0;background:#faf9f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2421">',
    '<div style="max-width:520px;margin:0 auto;padding:32px 24px">',
    `<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#0b7a52;margin:0 0 12px">SharePix</p>`,
    `<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">Your gallery for ${escapeHtml(name)} closes on ${escapeHtml(input.expiresOn)}.</h1>`,
    `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">After that the photos are archived and then permanently deleted. ${escapeHtml(action)}${escapeHtml(extend)}</p>`,
    url
      ? `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#12211c;color:#faf9f6;padding:14px 24px;text-decoration:none;font-weight:600">Open your gallery</a></p>`
      : '',
    `<p style="font-size:13px;line-height:1.6;color:#1f2421;opacity:.6;margin:24px 0 0">SharePix LLC</p>`,
    '</div></body></html>',
  ]
    .filter(Boolean)
    .join('');

  return { subject, html, text };
}
