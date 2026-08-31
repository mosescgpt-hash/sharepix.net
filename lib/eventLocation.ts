/**
 * Where an event took place, as the host describes it — city and state only.
 *
 * Deliberately NOT derived from photo GPS. Uploaded originals have their
 * coordinates stripped (see docs/moderation.md), and that stays true: this is a
 * single label the host sets once for the whole event, which is accurate for
 * the venue-based events SharePix serves, costs nothing to produce, and works
 * for the many uploads that carry no GPS at all (screenshots, location services
 * off, anything that passed through a messaging app).
 *
 * Precision stops at the city. There is no street address field, and none
 * should be added — the point is a memory label ("Minneapolis, MN"), not a
 * location record.
 */

/** How much of each part we keep; long enough for real places, bounded. */
const MAX_CITY = 60;
const MAX_STATE = 40;

/**
 * Clean one part of a location. Letters, digits, spaces and the punctuation
 * real place names use (St. Paul, Coeur d'Alene, Winston-Salem) survive;
 * everything else goes, so this can be shown and put in a filename safely.
 */
function cleanPart(value: string, maxLength: number): string {
  return value
    .replace(/[^\p{L}\p{N} .'\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export function sanitizeCity(value: string): string {
  return cleanPart(value, MAX_CITY);
}

export function sanitizeState(value: string): string {
  return cleanPart(value, MAX_STATE);
}

/**
 * The stored form: "Minneapolis, MN". Either part may be missing — a host who
 * fills in only one still gets a usable label, and an empty input stores
 * nothing rather than a stray comma.
 */
export function formatEventLocation(
  city: string | null | undefined,
  state: string | null | undefined,
): string {
  const parts = [sanitizeCity(city ?? ''), sanitizeState(state ?? '')].filter(Boolean);
  return parts.join(', ');
}

/** Split a stored "City, State" back into fields for editing. */
export function parseEventLocation(location: string | null | undefined): {
  city: string;
  state: string;
} {
  const raw = (location ?? '').trim();
  if (!raw) return { city: '', state: '' };
  const [city, ...rest] = raw.split(',');
  return { city: sanitizeCity(city ?? ''), state: sanitizeState(rest.join(',')) };
}
