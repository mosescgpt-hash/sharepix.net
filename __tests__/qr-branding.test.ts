import {
  DEFAULT_QR_COLOR,
  DEFAULT_QR_DOT_STYLE,
  MAX_QR_LOGO_CHARS,
  QR_COLOR_MIN_CONTRAST,
  brandingForEvent,
  isQrDotStyle,
  isStorableQrLogo,
  normalizeQrColor,
  qrColorContrast,
  qrColorVerdict,
  qrStylingOptions,
  validateQrBranding,
} from '../lib/qrBranding';

const pngLogo = (chars = 200) => `data:image/png;base64,${'A'.repeat(chars)}`;

describe('normalizeQrColor', () => {
  it('accepts six-digit hex and lowercases it', () => {
    expect(normalizeQrColor('#123851')).toBe('#123851');
    expect(normalizeQrColor('  #AABBCC  ')).toBe('#aabbcc');
  });

  it('expands the three-digit shorthand a colour input can produce', () => {
    expect(normalizeQrColor('#abc')).toBe('#aabbcc');
  });

  it('refuses anything else', () => {
    for (const value of ['red', '123851', '#12385', '#1234567', '', null, 42, undefined]) {
      expect(normalizeQrColor(value)).toBeNull();
    }
  });
});

describe('qrColorContrast', () => {
  it('is maximal for black and minimal for white', () => {
    expect(qrColorContrast('#000000')).toBeCloseTo(21, 0);
    expect(qrColorContrast('#ffffff')).toBeCloseTo(1, 2);
  });

  it('rates the brand navy as comfortably scannable', () => {
    expect(qrColorContrast('#123851')).toBeGreaterThan(10);
  });

  it('returns zero rather than throwing on a bad colour', () => {
    expect(qrColorContrast('nonsense')).toBe(0);
  });
});

describe('qrColorVerdict', () => {
  // The case this exists to prevent: a code that looks lovely on the dashboard
  // and will not scan once it is printed and sitting on a dim table.
  it('refuses colours too pale to print', () => {
    for (const pale of ['#ffe066', '#ffd6e7', '#e8f5a0', '#fff5cc']) {
      expect(qrColorVerdict(pale)).toBe('unscannable');
    }
  });

  it('passes dark brand colours', () => {
    for (const dark of ['#123851', '#0b2536', '#0b7a52', '#000000']) {
      expect(qrColorVerdict(dark)).toBe('ok');
    }
  });

  it('flags mid-tones as marginal rather than blocking them', () => {
    // Scans in good light, struggles in bad. The host is warned, not stopped.
    expect(qrColorVerdict('#099361')).toBe('marginal');
  });

  it('never calls anything below the floor acceptable', () => {
    for (const hex of ['#ffe066', '#ffffff', '#f0f0f0']) {
      expect(qrColorContrast(hex)).toBeLessThan(QR_COLOR_MIN_CONTRAST);
      expect(qrColorVerdict(hex)).toBe('unscannable');
    }
  });
});

describe('isStorableQrLogo', () => {
  it('accepts the image types we allow', () => {
    for (const type of ['png', 'jpeg', 'webp']) {
      expect(isStorableQrLogo(`data:image/${type};base64,AAAA`)).toBe(true);
    }
  });

  it('refuses types we do not', () => {
    expect(isStorableQrLogo('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isStorableQrLogo('data:text/html;base64,AAAA')).toBe(false);
  });

  // An SVG logo would be markup rendered into the page; the type allow-list is
  // what keeps a logo to actual raster bytes.
  it('refuses anything that is not a base64 data URL', () => {
    for (const value of ['https://example.com/logo.png', '<svg/>', '', null, undefined, 7]) {
      expect(isStorableQrLogo(value)).toBe(false);
    }
  });

  // The row has to fit in a DynamoDB item alongside everything else.
  it('refuses a logo past the size cap', () => {
    expect(isStorableQrLogo(pngLogo(MAX_QR_LOGO_CHARS + 100))).toBe(false);
    expect(isStorableQrLogo(pngLogo(1000))).toBe(true);
  });
});

describe('validateQrBranding', () => {
  it('accepts a full valid style', () => {
    const result = validateQrBranding({
      qrDotStyle: 'dots',
      qrColor: '#0B2536',
      qrLogo: pngLogo(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.branding.qrDotStyle).toBe('dots');
      expect(result.branding.qrColor).toBe('#0b2536');
      expect(result.branding.qrLogo).not.toBeNull();
    }
  });

  it('falls back to the defaults rather than half-styling an event', () => {
    const result = validateQrBranding({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.branding.qrDotStyle).toBe(DEFAULT_QR_DOT_STYLE);
      expect(result.branding.qrColor).toBe(DEFAULT_QR_COLOR);
      expect(result.branding.qrLogo).toBeNull();
    }
  });

  it('ignores a dot style it does not know', () => {
    const result = validateQrBranding({ qrDotStyle: 'sparkles' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.branding.qrDotStyle).toBe(DEFAULT_QR_DOT_STYLE);
  });

  it('refuses an unscannable colour with a reason a host can act on', () => {
    const result = validateQrBranding({ qrColor: '#ffe066' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/darker/i);
  });

  it('refuses a malformed colour', () => {
    expect(validateQrBranding({ qrColor: 'goldenrod' }).ok).toBe(false);
  });

  it('refuses a logo it cannot store', () => {
    expect(validateQrBranding({ qrLogo: 'data:image/svg+xml;base64,AAAA' }).ok).toBe(false);
    expect(validateQrBranding({ qrLogo: pngLogo(MAX_QR_LOGO_CHARS + 1) }).ok).toBe(false);
  });

  it('treats an empty logo as clearing it, not as an error', () => {
    const result = validateQrBranding({ qrLogo: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.branding.qrLogo).toBeNull();
  });
});

describe('brandingForEvent', () => {
  // The guarantee: an event saved before this existed renders exactly as it
  // always did.
  it('gives an unstyled event the original look', () => {
    for (const event of [null, undefined, {}, { qrDotStyle: null, qrColor: null }]) {
      expect(brandingForEvent(event)).toEqual({
        qrDotStyle: 'square',
        qrColor: DEFAULT_QR_COLOR,
        qrLogo: null,
      });
    }
  });

  it('reads back what was saved', () => {
    expect(
      brandingForEvent({ qrDotStyle: 'dots', qrColor: '#0B7A52', qrLogo: pngLogo() }),
    ).toEqual({ qrDotStyle: 'dots', qrColor: '#0b7a52', qrLogo: pngLogo() });
  });

  // A row that somehow holds junk must not break the dashboard or the tent.
  it('falls back rather than trusting a stored value', () => {
    expect(
      brandingForEvent({ qrDotStyle: 'sparkles', qrColor: 'red', qrLogo: 'http://x/y.png' }),
    ).toEqual({ qrDotStyle: 'square', qrColor: DEFAULT_QR_COLOR, qrLogo: null });
  });
});

describe('qrStylingOptions', () => {
  const branding = { qrDotStyle: 'dots' as const, qrColor: '#0b7a52', qrLogo: pngLogo() };

  it('carries the saved style into the renderer', () => {
    const options = qrStylingOptions(branding, { data: 'https://x/y', size: 640, margin: 12 });
    expect(options.dotsOptions).toEqual({ type: 'dots', color: '#0b7a52' });
    expect(options.image).toBe(pngLogo());
    expect(options.width).toBe(640);
  });

  // The one thing a host must never be able to theme.
  it('always keeps the background white, whatever the style', () => {
    for (const style of ['square', 'rounded', 'dots', 'classy-rounded'] as const) {
      const options = qrStylingOptions(
        { qrDotStyle: style, qrColor: '#123851', qrLogo: null },
        { data: 'https://x/y', size: 240, margin: 10 },
      );
      expect(options.backgroundOptions).toEqual({ color: '#ffffff' });
      expect(options.qrOptions.errorCorrectionLevel).toBe('H');
    }
  });

  it('uses round corners only for the round styles', () => {
    const dots = qrStylingOptions(
      { qrDotStyle: 'dots', qrColor: '#123851', qrLogo: null },
      { data: 'd', size: 100, margin: 0 },
    );
    const square = qrStylingOptions(
      { qrDotStyle: 'square', qrColor: '#123851', qrLogo: null },
      { data: 'd', size: 100, margin: 0 },
    );
    expect(dots.cornersSquareOptions.type).toBe('dot');
    expect(square.cornersSquareOptions.type).toBe('square');
  });

  it('omits the image entirely when there is no logo', () => {
    const options = qrStylingOptions(
      { qrDotStyle: 'square', qrColor: '#123851', qrLogo: null },
      { data: 'd', size: 100, margin: 0 },
    );
    expect(options.image).toBeUndefined();
  });
});

describe('isQrDotStyle', () => {
  it('knows the four styles and nothing else', () => {
    for (const style of ['square', 'rounded', 'dots', 'classy-rounded']) {
      expect(isQrDotStyle(style)).toBe(true);
    }
    for (const style of ['circle', '', null, undefined, 3]) {
      expect(isQrDotStyle(style)).toBe(false);
    }
  });
});
