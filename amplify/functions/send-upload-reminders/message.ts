/**
 * The reminder email: subject, HTML and text. Pure, so the copy is tested
 * without SES.
 *
 * Every message carries the event name, one button back to the upload page,
 * an unsubscribe link, and the sender's postal address (CAN-SPAM).
 */
import type { ReminderKind } from './rules';

/**
 * lib/businessInfo.ts BUSINESS_ADDRESS_LINES, copied because a Lambda cannot
 * import lib/. __tests__/upload-reminders.test.ts fails if they differ.
 */
export const POSTAL_ADDRESS_LINES = [
  'SharePix LLC',
  '617 Locust Street #1001',
  'Monticello, MN 55362',
  'United States',
];

export interface ReminderMessageInput {
  kind: ReminderKind;
  eventName: string;
  uploadUrl: string;
  unsubscribeUrl: string;
  /** "Saturday, August 5", in the event's time zone, or null. */
  closesOn: string | null;
}

export interface ReminderMessage {
  subject: string;
  html: string;
  text: string;
}

/** No CR/LF (header injection) and no runaway length in a subject line. */
export function headerSafe(value: string, max = 80): string {
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

export function buildReminderMessage(input: ReminderMessageInput): ReminderMessage {
  const name = headerSafe(input.eventName) || 'the event';
  const subject =
    input.kind === 'first'
      ? `Add your photos from ${name}`
      : `A few days left to add your photos from ${name}`;
  const lead =
    input.kind === 'first'
      ? `Thanks for adding photos to ${name}. If there are more on your phone from yesterday, there's still time to share them.`
      : `Uploads for ${name} close soon${input.closesOn ? `, on ${input.closesOn}` : ''}. If you have photos you haven't shared yet, add them before then.`;
  const closes = input.closesOn ? `Uploads close on ${input.closesOn}.` : '';
  const why = `You're getting this because you asked for a reminder when you added photos to ${name}.`;

  const text = [
    lead,
    '',
    `Add your photos: ${input.uploadUrl}`,
    closes,
    '',
    '--',
    why,
    `Unsubscribe: ${input.unsubscribeUrl}`,
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
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">${e(name)}</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${e(lead)}</p>
<p style="margin:0 0 24px"><a href="${e(input.uploadUrl)}" style="display:inline-block;background:#123851;color:#FBEFD1;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:8px">Add your photos</a></p>
${closes ? `<p style="margin:0;font-size:14px;color:#123851">${e(closes)}</p>` : ''}
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="padding:20px 28px;font-size:12px;line-height:1.5;color:#5b6b75">
<p style="margin:0 0 8px">${e(why)} <a href="${e(input.unsubscribeUrl)}" style="color:#5b6b75">Unsubscribe</a></p>
<p style="margin:0">${POSTAL_ADDRESS_LINES.map(e).join('<br>')}</p>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return { subject, html, text };
}

/** "Saturday, August 5" for an instant, in a zone. */
export function formatCloseDate(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  // The calendar day the window ends on, in the event's zone: what the host's
  // dashboard shows as the close date.
  return new Date(at).toLocaleDateString('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
