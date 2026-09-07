/**
 * The Lambda's copy of the attribution rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so these
 * rules exist twice. Everything below the header is byte-identical to
 * lib/attribution.ts and __tests__/attribution.test.ts fails if it drifts.
 *
 * This copy is the one that matters. The source arrives in the request, which
 * means it arrives from anyone; `normalizeSource` here is what decides whether
 * a claimed value is written to the row or quietly becomes `direct`. The
 * browser's copy only decides what a link says.
 */

/** Every source the product recognises. Add deliberately. */
export const EVENT_SOURCES = [
  /** No attribution: typed the address, a bookmark, or anything unrecognised. */
  'direct',
  /** Followed the prompt shown after uploading a photo as somebody's guest. */
  'guest_upload',
  /** Came from a gallery page without having uploaded. */
  'gallery',
  /** Followed the link on a printed table tent or brochure. */
  'print',
] as const;

export type EventSource = (typeof EVENT_SOURCES)[number];

export const DEFAULT_SOURCE: EventSource = 'direct';

/**
 * Read a claimed source into one we recognise, or `direct`.
 *
 * Never throws and never refuses: an unrecognised source is a mis-typed link
 * or someone poking at a query string, and neither is a reason to stop a
 * customer creating an event. Losing the attribution is the correct cost.
 */
export function normalizeSource(claimed: string | null | undefined): EventSource {
  const value = (claimed ?? '').trim().toLowerCase();
  return (EVENT_SOURCES as readonly string[]).includes(value)
    ? (value as EventSource)
    : DEFAULT_SOURCE;
}

/** Whether a stored value is one we recognise, for reading rows back. */
export function isKnownSource(value: string | null | undefined): value is EventSource {
  return (EVENT_SOURCES as readonly string[]).includes((value ?? '').trim().toLowerCase());
}

/** How a source reads in the admin dashboard. */
export const SOURCE_LABELS: Record<EventSource, string> = {
  direct: 'Direct',
  guest_upload: 'Was a guest first',
  gallery: 'From a gallery',
  print: 'From a printed code',
};

export function sourceLabel(value: string | null | undefined): string {
  return SOURCE_LABELS[normalizeSource(value)];
}

/**
 * Count events by source.
 *
 * Events created before this existed have no source and count as `direct`,
 * which is not quite true — they are *unknown* — but inventing a fifth bucket
 * for "we were not measuring yet" would make every chart carry a permanent
 * asterisk about a handful of early rows.
 */
export function countBySource(
  events: readonly { source?: string | null }[],
): Record<EventSource, number> {
  const counts = Object.fromEntries(EVENT_SOURCES.map((s) => [s, 0])) as Record<
    EventSource,
    number
  >;
  for (const event of events) counts[normalizeSource(event.source)] += 1;
  return counts;
}
