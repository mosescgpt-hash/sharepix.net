import { themeKeyForEvent } from '../lib/eventTheme';

const TCC_ID = '4b9fc2fa-e0d9-4090-8b8d-221ee8a9fa44';

describe('event theme targeting', () => {
  it('themes only the configured TCC event', () => {
    expect(themeKeyForEvent({ id: TCC_ID })).toBe('tcc-2026');
  });

  it('leaves every other event on the default experience', () => {
    expect(themeKeyForEvent({ id: 'some-other-event-id' })).toBeNull();
    expect(themeKeyForEvent({ id: '' })).toBeNull();
    expect(themeKeyForEvent(null)).toBeNull();
    expect(themeKeyForEvent(undefined)).toBeNull();
  });

  it('honours an explicit themeKey on the event if one is ever set', () => {
    expect(themeKeyForEvent({ id: 'x', themeKey: 'tcc-2026' })).toBe('tcc-2026');
  });

  it('ignores an unknown themeKey rather than trusting it', () => {
    expect(themeKeyForEvent({ id: 'x', themeKey: 'not-a-real-theme' })).toBeNull();
  });
});
