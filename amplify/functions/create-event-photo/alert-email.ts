/**
 * Builds the "photo held for review" alert email.
 *
 * Kept as pure string/byte assembly so the MIME structure and the escaping can
 * be unit tested without sending anything.
 *
 * The photo preview travels with the message as an inline attachment rather
 * than a hotlinked URL: the app's image URLs are short-lived signed links, so
 * an email opened an hour later would show a broken image.
 */

export interface AlertEmailInput {
  from: string;
  to: string;
  eventName: string;
  reasons: string;
  reviewUrl: string;
  /**
   * Where a host's reply should go. Useful when `from` is a send-only address
   * (e.g. pix@…) that no one reads — a Reply-To points replies at a real inbox.
   * Omit to let replies go to `from`.
   */
  replyTo?: string;
  /** Preview image bytes, embedded inline. Omit to send a text-only alert. */
  image?: { bytes: Uint8Array; contentType: string };
}

/** Escape text that gets interpolated into the HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only allow the app's own https review links into the button hrefs, so a
 * crafted value can never turn the alert into a phishing vector.
 */
export function isSafeReviewUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9.-]+\/review\/[a-f0-9]{16,}(\?[a-z=&_-]*)?$/i.test(url);
}

/**
 * Make a guest-supplied string safe to place in a MIME header. Event names come
 * from the host, but they still reach a header here, and a CR/LF inside one
 * would let the value inject extra headers (an extra Bcc, a forged From).
 * Strip line breaks and control characters, and bound the length.
 */
export function sanitizeHeaderValue(value: string, maxLength = 120): string {
  return value
    // Control characters — CR and LF among them — are what enable header
    // injection, so drop them rather than trying to encode them.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function toBase64Lines(bytes: Uint8Array): string {
  // Base64 in MIME parts is wrapped at 76 characters.
  const encoded = Buffer.from(bytes).toString('base64');
  return (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * The raw MIME message. `multipart/related` so the HTML body can reference the
 * embedded preview by Content-ID.
 *
 * The Approve/Deny buttons link to the review page carrying an intent — they
 * never perform the action by themselves. Mail scanners and link prefetchers
 * follow URLs in email, and a GET that released a photo would let a scanner
 * approve it before a human ever looked.
 */
export function buildAlertEmail(input: AlertEmailInput): string {
  const boundary = `sharepix-${Date.now().toString(36)}`;
  const safeUrl = isSafeReviewUrl(input.reviewUrl) ? input.reviewUrl : '';
  const eventName = escapeHtml(input.eventName || 'your event');
  const reasons = escapeHtml(input.reasons || 'possible explicit content');

  const approveUrl = safeUrl ? `${safeUrl}?intent=release` : '';
  const denyUrl = safeUrl ? `${safeUrl}?intent=dismiss` : '';

  const buttons = safeUrl
    ? `<p style="margin:24px 0;">
         <a href="${approveUrl}" style="background:#0f766e;color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block;margin-right:8px;">Approve — show it</a>
         <a href="${denyUrl}" style="background:#f1f5f9;color:#0f172a;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;display:inline-block;">Deny — keep hidden</a>
       </p>
       <p style="color:#64748b;font-size:12px;">Or open the review page: <a href="${safeUrl}">${safeUrl}</a></p>`
    : `<p style="color:#b91c1c;">The review link could not be generated. Open your event dashboard to review this photo.</p>`;

  const imageBlock = input.image
    ? `<p><img src="cid:heldphoto" alt="Photo held for review" style="max-width:100%;border-radius:12px;" /></p>`
    : `<p style="color:#64748b;">(Preview unavailable — open the review page to see the photo.)</p>`;

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:16px;">
  <h1 style="font-size:20px;margin:0 0 8px;">A photo is waiting for your review</h1>
  <p style="margin:0 0 4px;">Someone uploaded a photo to <strong>${eventName}</strong> that our screening flagged, so guests and the slideshow can't see it.</p>
  <p style="color:#92400e;background:#fffbeb;padding:8px 12px;border-radius:8px;display:inline-block;">Detected: ${reasons}</p>
  ${imageBlock}
  ${buttons}
  <p style="color:#64748b;font-size:12px;">Denying keeps the photo hidden. Nothing is deleted — you can remove it permanently from your event dashboard.</p>
</body></html>`;

  // Everything reaching a header is stripped of control characters first: a CR
  // or LF in an event name would otherwise inject extra headers.
  const subjectName = sanitizeHeaderValue(input.eventName ?? '', 80);
  const replyTo = sanitizeHeaderValue(input.replyTo ?? '', 200);
  const headers = [
    `From: ${sanitizeHeaderValue(input.from, 200)}`,
    `To: ${sanitizeHeaderValue(input.to, 200)}`,
    // Only when set, and only if it survived sanitizing to something non-empty.
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: A photo needs your review${subjectName ? ` — ${subjectName}` : ''}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"`,
  ].join('\r\n');

  const htmlPart = [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
  ].join('\r\n');

  const imagePart = input.image
    ? [
        '',
        `--${boundary}`,
        `Content-Type: ${input.image.contentType}`,
        'Content-Transfer-Encoding: base64',
        'Content-ID: <heldphoto>',
        'Content-Disposition: inline; filename="held-photo.jpg"',
        '',
        toBase64Lines(input.image.bytes),
      ].join('\r\n')
    : '';

  return [headers, '', htmlPart, imagePart, '', `--${boundary}--`, ''].join('\r\n');
}
