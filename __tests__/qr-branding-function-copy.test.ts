import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateQrBranding } from '../amplify/functions/update-event/qrBranding';
import { EDITABLE_FIELDS, buildPatch } from '../amplify/functions/update-event/settings';

/**
 * The Lambda's copy of the QR branding rules, and how the settings allow-list
 * uses them. The browser runs the same checks for fast feedback; this copy is
 * the one that decides.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function bodyOf(source: string): string {
  const end = source.indexOf('*/');
  return source.slice(end + 2).trim();
}

describe('the two copies have not drifted', () => {
  it('is byte-identical to lib/qrBranding.ts below the header', () => {
    expect(bodyOf(read('amplify/functions/update-event/qrBranding.ts'))).toBe(
      bodyOf(read('lib/qrBranding.ts')),
    );
  });
});

describe('the allow-list stays presentation-only', () => {
  it('includes the three branding fields', () => {
    for (const field of ['qrDotStyle', 'qrColor', 'qrLogo']) {
      expect(EDITABLE_FIELDS).toContain(field);
    }
  });

  // The whole point of the allow-list: nothing priced, counted or dated.
  it('still excludes everything that is money', () => {
    for (const field of [
      'tier',
      'paid',
      'photoLimit',
      'videoLimit',
      'photoCount',
      'videoCount',
      'extraPhotoCredits',
      'extraVideoCredits',
      'accessExpiresAt',
      'uploadWindowEndsAt',
      'guestBookEnabled',
      'liveSlideshowEnabled',
    ]) {
      expect(EDITABLE_FIELDS).not.toContain(field);
    }
  });
});

describe('branding through buildPatch', () => {
  const noPhotos = { photoCount: 0 };

  it('writes a whole style at once', () => {
    const result = buildPatch(
      { qrDotStyle: 'dots', qrColor: '#0B7A52', qrLogo: 'data:image/png;base64,AAAA' },
      noPhotos,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.set.qrDotStyle).toBe('dots');
      expect(result.patch.set.qrColor).toBe('#0b7a52');
      expect(result.patch.set.qrLogo).toBe('data:image/png;base64,AAAA');
    }
  });

  // Changing one part of the style must not silently drop the logo the host
  // uploaded, so the client always sends the whole style. What this asserts is
  // that a request WITHOUT a logo genuinely clears it, which is what makes
  // "remove my logo" work at all.
  it('clears the logo when the style is saved without one', () => {
    const result = buildPatch({ qrDotStyle: 'square', qrColor: '#123851' }, noPhotos);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.remove).toContain('qrLogo');
  });

  it('refuses a colour too pale to scan in print', () => {
    const result = buildPatch({ qrColor: '#ffe066' }, noPhotos);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/darker/i);
  });

  it('refuses a logo that is not a storable image', () => {
    expect(buildPatch({ qrLogo: 'https://example.com/logo.png' }, noPhotos).ok).toBe(false);
    expect(buildPatch({ qrLogo: 'data:image/svg+xml;base64,AAAA' }, noPhotos).ok).toBe(false);
  });

  it('leaves branding alone entirely when no branding field is sent', () => {
    const result = buildPatch({ name: 'Renamed' }, noPhotos);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch.set.qrDotStyle).toBeUndefined();
      expect(result.patch.remove).not.toContain('qrLogo');
    }
  });

  // Branding is presentation, so it must stay editable after guests upload —
  // unlike the name and date, which lock.
  it('still allows restyling once an event has photos', () => {
    const result = buildPatch({ qrDotStyle: 'rounded' }, { photoCount: 250 });
    expect(result.ok).toBe(true);
  });

  it('still locks the name once an event has photos', () => {
    expect(buildPatch({ name: 'Renamed' }, { photoCount: 250 }).ok).toBe(false);
  });
});

describe('the server copy enforces the rules', () => {
  it('agrees with the app about a pale colour', () => {
    expect(validateQrBranding({ qrColor: '#fff5cc' }).ok).toBe(false);
  });

  it('accepts the brand navy', () => {
    expect(validateQrBranding({ qrColor: '#123851' }).ok).toBe(true);
  });
});
