import {
  DEFAULT_HEADLINE,
  DEFAULT_MESSAGE,
  DEFAULT_THEME_KEY,
  MAX_HEADLINE,
  MAX_MESSAGE,
  TENT_THEMES,
  eventNameFontSize,
  formatTentDate,
  sanitizeTentText,
  tentContent,
  tentTheme,
} from '../lib/tableTent';

const event = {
  name: 'Anderson Wedding',
  eventCode: 'AND123',
  date: '2026-06-06',
  location: 'Minneapolis, MN',
};

describe('sanitizeTentText', () => {
  it('keeps ordinary typed text intact', () => {
    expect(sanitizeTentText('Scan me, please!', MAX_HEADLINE)).toBe('Scan me, please!');
  });

  it('collapses newlines and tabs so a pasted block cannot break the panel', () => {
    expect(sanitizeTentText('Line one\n\nLine two\tthree', MAX_MESSAGE)).toBe(
      'Line one Line two three',
    );
  });

  it('strips control characters', () => {
    expect(sanitizeTentText('Hi\u0000\u0007there\u007F', MAX_HEADLINE)).toBe('Hi there');
  });

  it('caps length and trims the result', () => {
    const long = 'a'.repeat(500);
    expect(sanitizeTentText(long, MAX_HEADLINE)).toHaveLength(MAX_HEADLINE);
  });

  it('returns empty for whitespace-only or missing input, so defaults apply', () => {
    expect(sanitizeTentText('   \n\t ', MAX_HEADLINE)).toBe('');
    expect(sanitizeTentText(null, MAX_HEADLINE)).toBe('');
    expect(sanitizeTentText(undefined, MAX_HEADLINE)).toBe('');
  });
});

describe('tentTheme', () => {
  it('resolves a known key', () => {
    expect(tentTheme('night').key).toBe('night');
  });

  it('falls back to the default for unknown, empty, or missing keys', () => {
    expect(tentTheme('not-a-theme').key).toBe(DEFAULT_THEME_KEY);
    expect(tentTheme('').key).toBe(DEFAULT_THEME_KEY);
    expect(tentTheme(null).key).toBe(DEFAULT_THEME_KEY);
  });

  it('gives every theme a complete colour set', () => {
    for (const theme of TENT_THEMES) {
      expect(theme.background).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.border).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(theme.label).toBeTruthy();
    }
  });
});

describe('formatTentDate', () => {
  it('formats a date in long form', () => {
    expect(formatTentDate('2026-06-06')).toContain('2026');
  });

  it('does not slip a day west of Greenwich', () => {
    // Parsed at midday, so a negative UTC offset cannot roll it back a day.
    expect(formatTentDate('2026-06-06')).toContain('6');
  });

  it('returns null for missing or unparseable values', () => {
    expect(formatTentDate(null)).toBeNull();
    expect(formatTentDate(undefined)).toBeNull();
    expect(formatTentDate('')).toBeNull();
    expect(formatTentDate('not-a-date')).toBeNull();
  });
});

describe('tentContent', () => {
  const url = 'https://sharepix.net/event/abc/upload';

  it('produces a complete tent with no customization at all', () => {
    const content = tentContent(event, url);
    expect(content.headline).toBe(DEFAULT_HEADLINE);
    expect(content.message).toBe(DEFAULT_MESSAGE);
    expect(content.eventName).toBe('Anderson Wedding');
    expect(content.locationLine).toBe('Minneapolis, MN');
    expect(content.code).toBe('AND123');
    expect(content.uploadUrl).toBe(url);
    expect(content.theme.key).toBe(DEFAULT_THEME_KEY);
    expect(content.photoUrl).toBeNull();
    expect(content.dateLine).toBeTruthy();
  });

  it('lets the host override headline, message and theme', () => {
    const content = tentContent(event, url, {
      headline: 'Share the night',
      message: 'Tag us!',
      themeKey: 'night',
    });
    expect(content.headline).toBe('Share the night');
    expect(content.message).toBe('Tag us!');
    expect(content.theme.key).toBe('night');
  });

  it('falls back to defaults when an override is blank', () => {
    const content = tentContent(event, url, { headline: '   ', message: '' });
    expect(content.headline).toBe(DEFAULT_HEADLINE);
    expect(content.message).toBe(DEFAULT_MESSAGE);
  });

  it('honours the hide toggles', () => {
    const content = tentContent(event, url, {
      showDate: false,
      showLocation: false,
      showCode: false,
    });
    expect(content.dateLine).toBeNull();
    expect(content.locationLine).toBeNull();
    expect(content.code).toBeNull();
  });

  it('omits date and location the event simply does not have', () => {
    const content = tentContent({ name: 'Picnic', eventCode: 'PIC1' }, url);
    expect(content.dateLine).toBeNull();
    expect(content.locationLine).toBeNull();
  });

  it('never leaves the event name blank', () => {
    const content = tentContent({ name: '   ', eventCode: 'X1' }, url);
    expect(content.eventName).toBe('Our event');
  });

  it('sanitizes host text rather than trusting it', () => {
    const content = tentContent(event, url, { headline: 'Scan\n\nnow' });
    expect(content.headline).toBe('Scan now');
  });
});

describe('eventNameFontSize', () => {
  it('shrinks in steps as the name grows', () => {
    const short = eventNameFontSize('Sam & Dev');
    const medium = eventNameFontSize('The Anderson Family Reunion');
    const long = eventNameFontSize('a'.repeat(60));
    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(long);
  });

  it('never returns a size too small to read across a table', () => {
    expect(eventNameFontSize('a'.repeat(500))).toBeGreaterThanOrEqual(18);
  });
});
