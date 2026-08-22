/**
 * Per-event presentation themes.
 *
 * There is no general theming system, so this is the smallest maintainable
 * thing that does the job: a lookup from event id to a theme key. Only the
 * guest upload experience reads it, and only for the events listed here — every
 * other event gets the default SharePix experience.
 *
 * Adding a themed event is one line in EVENT_THEMES. Prefer keying on the event
 * id (stable, already known); an event model may later carry its own `themeKey`
 * field, which is honoured first so this table can eventually empty out.
 */

export type EventThemeKey = 'tcc-2026';

/** Event id → theme. */
const EVENT_THEMES: Record<string, EventThemeKey> = {
  // Twin Cities Con 2026 — comic-convention cosplay gallery.
  '4b9fc2fa-e0d9-4090-8b8d-221ee8a9fa44': 'tcc-2026',
};

/**
 * The theme for an event, or null for the default experience. Tolerates a
 * future `themeKey` on the event (used first), then falls back to the id map.
 */
export function themeKeyForEvent(
  event: { id?: string | null; themeKey?: string | null } | null | undefined,
): EventThemeKey | null {
  if (!event) return null;
  if (event.themeKey && isEventThemeKey(event.themeKey)) return event.themeKey;
  const id = event.id ?? '';
  return EVENT_THEMES[id] ?? null;
}

function isEventThemeKey(value: string): value is EventThemeKey {
  return value === 'tcc-2026';
}
