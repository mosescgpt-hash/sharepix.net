/**
 * The time zones a host picks from. US zones first, since that is who
 * SharePix sells to, then every zone the browser knows.
 */
export const COMMON_TIME_ZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain, no DST (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
];

/** Every IANA zone the browser supports, or just the common ones if it can't say. */
export function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? COMMON_TIME_ZONES.map((z) => z.value);
  } catch {
    return COMMON_TIME_ZONES.map((z) => z.value);
  }
}

/** The browser's own zone, the sensible default for a host setting up. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
}
