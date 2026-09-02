import {
  EVENT_THEMES,
  isEventThemeKey,
  themeKeyForEvent,
  themeLabel,
} from '../lib/eventTheme';

/** The event themed by id before `themeKey` existed. */
const LEGACY_TCC_ID = '4b9fc2fa-e0d9-4090-8b8d-221ee8a9fa44';

describe('the themes an admin can assign', () => {
  it('offers TCC 2026, each entry complete', () => {
    expect(EVENT_THEMES.map((t) => t.key)).toContain('tcc-2026');
    for (const theme of EVENT_THEMES) {
      expect(theme.key).toBeTruthy();
      expect(theme.label).toBeTruthy();
      expect(theme.description).toBeTruthy();
    }
  });

  it('recognises exactly the keys it offers', () => {
    for (const theme of EVENT_THEMES) expect(isEventThemeKey(theme.key)).toBe(true);
    for (const value of ['', '  ', 'tcc', 'TCC-2026', 'not-a-theme', null, undefined]) {
      expect(isEventThemeKey(value)).toBe(false);
    }
  });

  it('labels a key, and calls no theme "Default"', () => {
    expect(themeLabel('tcc-2026')).toBe('Twin Cities Con 2026');
    expect(themeLabel(null)).toBe('Default');
    expect(themeLabel('not-a-theme')).toBe('Default');
  });
});

describe('which theme an event gets', () => {
  it('uses the event’s own key', () => {
    expect(themeKeyForEvent({ id: 'x', themeKey: 'tcc-2026' })).toBe('tcc-2026');
  });

  it('leaves an event with no key on the default experience', () => {
    expect(themeKeyForEvent({ id: 'some-other-event-id' })).toBeNull();
    expect(themeKeyForEvent({ id: '' })).toBeNull();
    expect(themeKeyForEvent(null)).toBeNull();
    expect(themeKeyForEvent(undefined)).toBeNull();
  });

  it('ignores an unknown key rather than trusting it', () => {
    // This value reaches the browser and decides which component renders.
    expect(themeKeyForEvent({ id: 'x', themeKey: 'not-a-real-theme' })).toBeNull();
  });

  it('still themes the pilot event, which predates the field', () => {
    expect(themeKeyForEvent({ id: LEGACY_TCC_ID })).toBe('tcc-2026');
  });

  it('lets an admin un-theme the pilot event', () => {
    // The whole point of making this assignable: clearing it from the dashboard
    // must win over the hardcoded table, or that one event could never go back
    // to the default experience without a deploy.
    expect(themeKeyForEvent({ id: LEGACY_TCC_ID, themeKey: '' })).toBeNull();
    expect(themeKeyForEvent({ id: LEGACY_TCC_ID, themeKey: null })).toBe('tcc-2026');
  });

  it('lets an admin theme any event without a deploy', () => {
    const freshEvent = { id: 'a-brand-new-uuid', themeKey: 'tcc-2026' };
    expect(themeKeyForEvent(freshEvent)).toBe('tcc-2026');
  });
});
