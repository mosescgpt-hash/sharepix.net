import {
  formatEventLocation,
  parseEventLocation,
  sanitizeCity,
  sanitizeState,
} from '../lib/eventLocation';

describe('formatting a location', () => {
  it('joins city and state', () => {
    expect(formatEventLocation('Minneapolis', 'MN')).toBe('Minneapolis, MN');
  });

  it('keeps a usable label when only one part is given', () => {
    expect(formatEventLocation('Minneapolis', '')).toBe('Minneapolis');
    expect(formatEventLocation('', 'MN')).toBe('MN');
  });

  it('stores nothing rather than a stray comma when nothing is entered', () => {
    expect(formatEventLocation('', '')).toBe('');
    expect(formatEventLocation(null, undefined)).toBe('');
    expect(formatEventLocation('   ', '  ')).toBe('');
  });

  it('keeps the punctuation real place names use', () => {
    expect(formatEventLocation('St. Paul', 'MN')).toBe('St. Paul, MN');
    expect(formatEventLocation("Coeur d'Alene", 'ID')).toBe("Coeur d'Alene, ID");
    expect(formatEventLocation('Winston-Salem', 'NC')).toBe('Winston-Salem, NC');
  });

  it('keeps non-English place names', () => {
    expect(formatEventLocation('Montréal', 'QC')).toBe('Montréal, QC');
  });

  it('strips characters that could break markup or a filename', () => {
    const out = formatEventLocation('<script>alert(1)</script>', 'MN/../..');
    expect(out).not.toMatch(/[<>/\\]/);
  });

  it('collapses runaway whitespace', () => {
    expect(formatEventLocation('  New    York  ', ' NY ')).toBe('New York, NY');
  });

  it('bounds absurdly long input', () => {
    expect(sanitizeCity('a'.repeat(500)).length).toBeLessThanOrEqual(60);
    expect(sanitizeState('b'.repeat(500)).length).toBeLessThanOrEqual(40);
  });
});

describe('parsing a stored location back into fields', () => {
  it('round-trips a normal location', () => {
    expect(parseEventLocation('Minneapolis, MN')).toEqual({ city: 'Minneapolis', state: 'MN' });
  });

  it('handles a city-only value', () => {
    expect(parseEventLocation('Minneapolis')).toEqual({ city: 'Minneapolis', state: '' });
  });

  it('handles an empty or missing value', () => {
    expect(parseEventLocation('')).toEqual({ city: '', state: '' });
    expect(parseEventLocation(null)).toEqual({ city: '', state: '' });
    expect(parseEventLocation(undefined)).toEqual({ city: '', state: '' });
  });

  it('keeps extra commas with the state rather than dropping them', () => {
    expect(parseEventLocation('Washington, DC, USA')).toEqual({
      city: 'Washington',
      state: 'DC USA',
    });
  });

  it('survives a round trip through format and parse', () => {
    const parsed = parseEventLocation(formatEventLocation('St. Paul', 'MN'));
    expect(parsed).toEqual({ city: 'St. Paul', state: 'MN' });
  });
});
