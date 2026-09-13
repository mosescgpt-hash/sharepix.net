import {
  EVENT_CODE_MAX_LENGTH,
  EVENT_CODE_MIN_LENGTH,
  EVENT_CODE_WORD_COUNT,
  formatEventCode,
  isEventCodeShaped,
  isLegacyEventCode,
  normalizeEventCode,
} from '../lib/eventCodeFormat';

describe('reading what a guest actually typed', () => {
  // None of this is their mistake: they paste from a text message, their phone
  // capitalises, their keyboard picks a different dash.
  it('accepts the code as stored', () => {
    expect(normalizeEventCode('brave-copper-lantern')).toBe('brave-copper-lantern');
  });

  it('accepts capitals, spaces and stray whitespace', () => {
    for (const typed of [
      'Brave-Copper-Lantern',
      '  brave-copper-lantern  ',
      'brave copper lantern',
      'BRAVE COPPER LANTERN',
    ]) {
      expect(normalizeEventCode(typed)).toBe('brave-copper-lantern');
    }
  });

  it('accepts the dashes a phone or word processor substitutes', () => {
    // en dash, em dash, non-breaking hyphen, minus sign, underscore
    for (const dash of ['‐', '–', '—', '−', '_']) {
      expect(normalizeEventCode(`brave${dash}copper${dash}lantern`)).toBe(
        'brave-copper-lantern',
      );
    }
  });

  it('collapses repeated separators and trims them from the ends', () => {
    expect(normalizeEventCode('-brave--copper---lantern-')).toBe('brave-copper-lantern');
  });

  it('returns empty for nothing at all', () => {
    for (const input of [null, undefined, '', '   ', '---']) {
      expect(normalizeEventCode(input)).toBe('');
    }
  });
});

describe('which codes could exist', () => {
  it('recognises a three-word code', () => {
    expect(isEventCodeShaped('brave-copper-lantern')).toBe(true);
    expect(EVENT_CODE_WORD_COUNT).toBe(3);
  });

  it('refuses the wrong number of words', () => {
    expect(isEventCodeShaped('brave-copper')).toBe(false);
    expect(isEventCodeShaped('brave-copper-lantern-river')).toBe(false);
  });

  it('refuses words outside the length EFF words run to', () => {
    expect(isEventCodeShaped('ab-copper-lantern')).toBe(false);
    expect(isEventCodeShaped('extraordinary-copper-lantern')).toBe(false);
  });

  it('refuses digits and punctuation inside a word code', () => {
    expect(isEventCodeShaped('brave-copper-lant3rn')).toBe(false);
    expect(isEventCodeShaped("brave-copper-lantern'")).toBe(false);
  });

  it('still accepts a code from before words', () => {
    // Nothing rewrites a code once a sign is printed with it, and a guest
    // holding an old card should not be told theirs is malformed.
    expect(isEventCodeShaped('K7M2QX')).toBe(true);
    expect(isLegacyEventCode('K7M2QX')).toBe(true);
    expect(isLegacyEventCode('brave-copper-lantern')).toBe(false);
  });

  it('refuses a legacy code using the letters that alphabet excluded', () => {
    // 0/O and 1/I/L never appeared in one, so anything containing them is a
    // misreading rather than a code.
    for (const code of ['K7M2QO', 'K7M2QI', 'K7M2Q0']) {
      expect(isEventCodeShaped(code)).toBe(false);
    }
  });

  it('bounds match what three EFF words can produce', () => {
    expect('abc-abc-abc'.length).toBe(EVENT_CODE_MIN_LENGTH);
    expect('abcdefghi-abcdefghi-abcdefghi'.length).toBe(EVENT_CODE_MAX_LENGTH);
  });
});

describe('showing a code back', () => {
  it('prints words as typed and keeps a legacy code upper case', () => {
    expect(formatEventCode('Brave Copper Lantern')).toBe('brave-copper-lantern');
    expect(formatEventCode('k7m2qx')).toBe('K7M2QX');
  });
});
