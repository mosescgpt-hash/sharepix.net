import {
  buildAlertEmail,
  escapeHtml,
  isSafeReviewUrl,
  sanitizeHeaderValue,
} from '../amplify/functions/create-event-photo/alert-email';

const TOKEN = 'a'.repeat(64);
const REVIEW_URL = `https://www.sharepix.net/review/${TOKEN}`;

const base = {
  from: 'alerts@sharepix.net',
  to: 'host@example.com',
  eventName: 'Sam & Riley',
  reasons: 'Explicit Nudity',
  reviewUrl: REVIEW_URL,
};

describe('escapeHtml', () => {
  it('neutralizes markup in interpolated text', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml('Sam & Riley')).toBe('Sam &amp; Riley');
    expect(escapeHtml(`"quoted" 'single'`)).toBe('&quot;quoted&quot; &#39;single&#39;');
  });
});

describe('isSafeReviewUrl', () => {
  it('accepts the app’s own https review links', () => {
    expect(isSafeReviewUrl(REVIEW_URL)).toBe(true);
    expect(isSafeReviewUrl(`${REVIEW_URL}?intent=release`)).toBe(true);
  });

  it('rejects anything that is not an https review link', () => {
    expect(isSafeReviewUrl(`http://www.sharepix.net/review/${TOKEN}`)).toBe(false);
    expect(isSafeReviewUrl('https://evil.example.com/phish')).toBe(false);
    expect(isSafeReviewUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeReviewUrl('https://www.sharepix.net/review/short')).toBe(false);
    expect(isSafeReviewUrl('')).toBe(false);
  });
});

describe('sanitizeHeaderValue', () => {
  it('strips CR/LF so a value cannot inject extra headers', () => {
    expect(sanitizeHeaderValue('Sam\r\nBcc: attacker@example.com')).toBe(
      'Sam Bcc: attacker@example.com',
    );
    expect(sanitizeHeaderValue('a\nb')).toBe('a b');
  });

  it('keeps ordinary punctuation intact', () => {
    expect(sanitizeHeaderValue("Sam & Riley's Wedding — 2026")).toBe(
      "Sam & Riley's Wedding — 2026",
    );
  });

  it('bounds the length', () => {
    expect(sanitizeHeaderValue('x'.repeat(300), 50)).toHaveLength(50);
  });
});

describe('buildAlertEmail', () => {
  it('omits Reply-To when none is given', () => {
    const headerBlock = buildAlertEmail(base).split('\r\n\r\n')[0];
    expect(headerBlock).not.toMatch(/^Reply-To:/m);
  });

  it('adds a Reply-To when one is given, so replies reach a real inbox', () => {
    const headerBlock = buildAlertEmail({ ...base, replyTo: 'info@sharepix.net' }).split('\r\n\r\n')[0];
    expect(headerBlock).toMatch(/^Reply-To: info@sharepix\.net$/m);
  });

  it('sanitizes the Reply-To so it cannot inject headers', () => {
    const headerBlock = buildAlertEmail({
      ...base,
      replyTo: 'info@sharepix.net\r\nBcc: attacker@example.com',
    }).split('\r\n\r\n')[0];
    expect(headerBlock).not.toMatch(/^Bcc:/m);
    expect(headerBlock.split('\r\n').filter((l) => l.startsWith('Reply-To:'))).toHaveLength(1);
  });

  it('does not let an event name break out of the Subject header', () => {
    const mime = buildAlertEmail({
      ...base,
      eventName: 'Party\r\nBcc: attacker@example.com',
    });
    const headerBlock = mime.split('\r\n\r\n')[0];
    expect(headerBlock).not.toMatch(/^Bcc:/m);
    expect(headerBlock.split('\r\n').filter((l) => l.startsWith('Subject:'))).toHaveLength(1);
  });

  it('builds a multipart/related message with the preview attached inline', () => {
    const mime = buildAlertEmail({
      ...base,
      image: { bytes: new Uint8Array([1, 2, 3, 4]), contentType: 'image/jpeg' },
    });

    expect(mime).toContain('To: host@example.com');
    expect(mime).toContain('From: alerts@sharepix.net');
    expect(mime).toContain('Content-Type: multipart/related');
    // The HTML references the attachment by Content-ID rather than a URL.
    expect(mime).toContain('Content-ID: <heldphoto>');
    expect(mime).toContain('src="cid:heldphoto"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
  });

  it('links the buttons to the review page with an intent, never auto-acting', () => {
    const mime = buildAlertEmail(base);
    expect(mime).toContain(`${REVIEW_URL}?intent=release`);
    expect(mime).toContain(`${REVIEW_URL}?intent=dismiss`);
  });

  it('escapes the event name and reasons in the HTML body', () => {
    const mime = buildAlertEmail({
      ...base,
      eventName: '<b>Hack</b> & Co',
      reasons: '<img onerror=x>',
    });
    // Assert against the HTML part specifically. The Subject header may carry
    // the raw characters, which is harmless — it renders as plain text — but
    // markup reaching the HTML body would not be.
    const htmlBody = mime.slice(mime.indexOf('<!doctype html>'));
    expect(htmlBody).toContain('&lt;b&gt;Hack&lt;/b&gt; &amp; Co');
    expect(htmlBody).toContain('&lt;img onerror=x&gt;');
    expect(htmlBody).not.toContain('<b>Hack</b>');
    expect(htmlBody).not.toContain('<img onerror=x>');
  });

  it('refuses to put an untrusted URL in the buttons', () => {
    const mime = buildAlertEmail({ ...base, reviewUrl: 'https://evil.example.com/phish' });
    expect(mime).not.toContain('evil.example.com');
    expect(mime).toContain('could not be generated');
  });

  it('still sends a usable alert when the preview is unavailable', () => {
    const mime = buildAlertEmail(base);
    expect(mime).toContain('Preview unavailable');
    expect(mime).toContain(REVIEW_URL);
    expect(mime).not.toContain('Content-ID:');
  });

  it('wraps base64 payloads at MIME line length', () => {
    const mime = buildAlertEmail({
      ...base,
      image: { bytes: new Uint8Array(600).fill(65), contentType: 'image/jpeg' },
    });
    const longest = mime
      .split('\r\n')
      .filter((line) => /^[A-Za-z0-9+/=]+$/.test(line) && line.length > 40)
      .reduce((max, line) => Math.max(max, line.length), 0);
    expect(longest).toBeLessThanOrEqual(76);
  });
});
