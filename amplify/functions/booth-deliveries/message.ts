/**
 * The booth delivery emails: subject, HTML and text. Pure, so the copy is
 * tested without SES. Every message carries one button to the attendee's
 * private gallery, a way to stop these emails, and the sender's postal
 * address (CAN-SPAM).
 */

/**
 * lib/businessInfo.ts BUSINESS_ADDRESS_LINES, copied because a Lambda cannot
 * import lib/. __tests__/booth-deliveries.test.ts fails if they differ.
 */
export const POSTAL_ADDRESS_LINES = [
  'SharePix LLC',
  '617 Locust Street #1001',
  'Monticello, MN 55362',
  'United States',
];

export type BoothMessageKind = 'ready' | 'more' | 'reminder';

export interface BoothMessageInput {
  kind: BoothMessageKind;
  attendeeName: string;
  eventName: string;
  galleryUrl: string;
  stopUrl: string;
  photoCount: number;
  /** "Saturday, February 7", or null when no removal date is known. */
  removedOn: string | null;
}

export interface BoothMessage {
  subject: string;
  html: string;
  text: string;
}

/** No CR/LF (header injection) and no runaway length in a subject line. */
export function headerSafe(value: string, max = 80): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildBoothMessage(input: BoothMessageInput): BoothMessage {
  const event = headerSafe(input.eventName) || 'the event';
  const first = headerSafe(input.attendeeName, 40).split(' ')[0] || 'there';
  const photos = `${input.photoCount} photo${input.photoCount === 1 ? '' : 's'}`;

  const subject =
    input.kind === 'ready'
      ? `Your photos from ${event} are ready`
      : input.kind === 'more'
        ? `More of your photos from ${event}`
        : `Download your photos from ${event} before they're removed`;

  const lead =
    input.kind === 'ready'
      ? `Hi ${first}, the photographer at ${event} has sent you ${photos}, full resolution.`
      : input.kind === 'more'
        ? `Hi ${first}, more of your photos from ${event} are ready. You now have ${photos}.`
        : `Hi ${first}, your full-resolution photos from ${event} will be removed${
            input.removedOn ? ` on ${input.removedOn}` : ' soon'
          }. Download any you want to keep before then.`;

  const keep =
    input.kind !== 'reminder' && input.removedOn
      ? `Full-resolution downloads are available until ${input.removedOn}.`
      : '';
  const why = `You're getting this because you signed up for your photos at ${event}.`;
  const button = input.kind === 'reminder' ? 'Download your photos' : 'See your photos';

  const text = [
    lead,
    '',
    `${button}: ${input.galleryUrl}`,
    keep,
    '',
    'Only you have this link, so keep it to yourself.',
    '',
    '--',
    why,
    `Stop these emails: ${input.stopUrl}`,
    '',
    ...POSTAL_ADDRESS_LINES,
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  const e = escapeHtml;
  const html = `<!doctype html>
<html><body style="margin:0;background:#FBEFD1;font-family:Helvetica,Arial,sans-serif;color:#123851">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBEFD1"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px">
<tr><td style="padding:32px 28px">
<p style="margin:0 0 8px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#099361;font-weight:bold">SharePix</p>
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${e(event)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${e(lead)}</p>
<p style="margin:0 0 24px"><a href="${e(input.galleryUrl)}" style="display:inline-block;background:#123851;color:#FBEFD1;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:8px">${e(button)}</a></p>
${keep ? `<p style="margin:0 0 12px;font-size:14px">${e(keep)}</p>` : ''}
<p style="margin:0;font-size:13px;color:#5b6b75">Only you have this link, so keep it to yourself.</p>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="padding:20px 28px;font-size:12px;line-height:1.5;color:#5b6b75">
<p style="margin:0 0 8px">${e(why)} <a href="${e(input.stopUrl)}" style="color:#5b6b75">Stop these emails</a></p>
<p style="margin:0">${POSTAL_ADDRESS_LINES.map(e).join('<br>')}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}

/** "Saturday, February 7" for an instant, in UTC (the removal runs on UTC days). */
export function formatRemovalDate(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
