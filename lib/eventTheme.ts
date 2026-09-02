/**
 * Per-event presentation themes.
 *
 * There is no general theming system, so this is the smallest maintainable
 * thing that does the job: an event carries a theme key, and only the guest
 * upload experience reads it. Every event without one gets the default
 * SharePix experience.
 *
 * A theme is assigned from the global-admin dashboard, which writes `themeKey`
 * straight onto the event. That is deliberately an admin-only power: the Event
 * model grants hosts no `update` at all, and `themeKey` is not on the
 * updateEventSettings allow-list, so a host cannot put their own event into
 * someone else's branded experience.
 *
 * LEGACY_EVENT_THEMES below predates the field. It stays so the events themed
 * before `themeKey` existed keep working, and it is consulted only when an
 * event has no key of its own. New entries belong in the dashboard, not here.
 */

export type EventThemeKey = 'tcc-2026';

/**
 * The themes an admin can pick, with the label the dashboard shows. Adding a
 * theme is one entry here plus the component that renders it — the type, the
 * validator and the dashboard menu all derive from this list.
 */
export const EVENT_THEMES: { key: EventThemeKey; label: string; description: string }[] = [
  {
    key: 'tcc-2026',
    label: 'Twin Cities Con 2026',
    description: 'Comic-convention cosplay upload experience',
  },
];

/**
 * Events themed by id before `themeKey` existed. Do not add to this — assign
 * the theme from the dashboard instead, which survives without a deploy.
 */
const LEGACY_EVENT_THEMES: Record<string, EventThemeKey> = {
  // Twin Cities Con 2026 — the original pilot event.
  '4b9fc2fa-e0d9-4090-8b8d-221ee8a9fa44': 'tcc-2026',
};

export function isEventThemeKey(value: string | null | undefined): value is EventThemeKey {
  return EVENT_THEMES.some((theme) => theme.key === value);
}

/**
 * The theme for an event, or null for the default experience.
 *
 * The event's own key wins, so reassigning from the dashboard always takes
 * effect — including setting it back to the default on an event that appears in
 * the legacy table. An unrecognised key is ignored rather than trusted, because
 * this value reaches the browser and decides which component renders.
 */
export function themeKeyForEvent(
  event: { id?: string | null; themeKey?: string | null } | null | undefined,
): EventThemeKey | null {
  if (!event) return null;

  // An explicitly cleared key means "default", and must not fall through to the
  // legacy table — otherwise the pilot event could never be un-themed.
  const own = event.themeKey;
  if (own !== undefined && own !== null && own !== '') {
    return isEventThemeKey(own) ? own : null;
  }
  if (own === '') return null;

  return LEGACY_EVENT_THEMES[event.id ?? ''] ?? null;
}

/** The label an admin sees for a theme key, or 'Default' for none. */
export function themeLabel(key: string | null | undefined): string {
  return EVENT_THEMES.find((theme) => theme.key === key)?.label ?? 'Default';
}
