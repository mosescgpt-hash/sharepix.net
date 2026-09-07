/**
 * Where an event came from.
 *
 * One field on the event row, set once at creation, answering the only
 * acquisition question that matters right now: did anybody who used SharePix as
 * a *guest* go on to create an event of their own?
 *
 * ## Why this is not analytics
 *
 * The growth-loop brief asks for four tracked steps — CTA shown, clicked,
 * signup started, purchase completed — and three of those need an analytics
 * provider that does not exist here. This deliberately does not pretend to be
 * one. It records the last step, the one that is worth money, in our own
 * database, where it survives ad blockers, consent banners and whatever
 * provider gets chosen later. Impressions and clicks can be added on top when
 * there is something to add them to; the conversion is the part that would be
 * painful to lose.
 *
 * ## Why a closed set
 *
 * A source arrives as a URL parameter, which means it arrives from anyone. It
 * is then stored, listed in the admin dashboard, and eventually counted in a
 * report. Free text there is a stored-content hole and a data-quality one at
 * the same time — a thousand spellings of the same campaign, plus whatever
 * someone decides to put in a query string. Anything not on this list becomes
 * `direct`, silently and without complaint.
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
