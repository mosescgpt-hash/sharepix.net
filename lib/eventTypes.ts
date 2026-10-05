/**
 * What kind of event this is, asked first when a host creates one.
 *
 * ## Why it is the first question
 *
 * Every other choice a host makes gets easier once SharePix knows the answer.
 * A wedding starts with a look that suits a wedding, the name field suggests a
 * wedding name, and the Design tab puts the looks that suit a wedding first.
 * Nobody has to design anything to end up with a gallery that looks finished.
 *
 * ## The values are the survey's
 *
 * Same closed set as the post-event survey's `eventType` question
 * (SURVEY_QUESTIONS in lib/survey.ts), and stored on the same `Event.eventType`
 * field the survey already pre-selects from. One vocabulary, so a wedding at
 * creation is a wedding in the survey numbers. The create-event function keeps
 * its own copy (amplify/functions/create-event/newEvent.ts, EVENT_TYPE_VALUES)
 * because functions take no cross-bundle imports; a test keeps the two equal.
 */
import type { ImageSlot } from './imagery';

export type EventTypeValue =
  | 'wedding'
  | 'graduation'
  | 'birthday'
  | 'anniversary'
  | 'family-reunion'
  | 'church'
  | 'school-team'
  | 'corporate'
  | 'other';

export interface EventTypeOption {
  value: EventTypeValue;
  label: string;
  /** The name field's example, so the first thing typed fits the occasion. */
  namePlaceholder: string;
  /**
   * STARTER_LOOKS keys, best first. The first one is applied when the event is
   * created; all of them are shown first in the Design tab.
   */
  looks: string[];
  /** A photograph for the tile, where the site has one. */
  image?: ImageSlot;
  /**
   * Whether "who will add the photos" is worth asking at creation. Only where
   * the answer is often "just me" — a church or a school sharing with parents.
   * Everywhere else it defaults to guests and stays changeable in Guests.
   */
  asksAudience?: boolean;
}

export const EVENT_TYPES: EventTypeOption[] = [
  {
    value: 'wedding',
    label: 'Wedding',
    namePlaceholder: 'Sam & Riley’s Wedding',
    looks: ['ivory', 'romantic', 'garden'],
    image: 'occasion-wedding',
  },
  {
    value: 'birthday',
    label: 'Birthday',
    namePlaceholder: 'Maya’s 40th',
    looks: ['party', 'signature', 'coastal'],
    image: 'occasion-birthday',
  },
  {
    value: 'graduation',
    label: 'Graduation',
    namePlaceholder: 'Jordan’s Graduation Party',
    looks: ['signature', 'party', 'linen'],
    image: 'occasion-graduation',
  },
  {
    value: 'corporate',
    label: 'Corporate event',
    namePlaceholder: 'Acme Annual Conference 2026',
    looks: ['signature', 'sharepix', 'golden'],
    image: 'occasion-corporate',
  },
  {
    value: 'family-reunion',
    label: 'Family reunion',
    namePlaceholder: 'Johnson Family Reunion',
    looks: ['linen', 'garden', 'coastal'],
    image: 'occasion-reunion',
  },
  {
    value: 'anniversary',
    label: 'Anniversary',
    namePlaceholder: 'Pat & Lee’s 25th Anniversary',
    looks: ['golden', 'ivory', 'romantic'],
  },
  {
    value: 'church',
    label: 'Church event',
    namePlaceholder: 'Grace Church Summer Picnic',
    looks: ['linen', 'ivory', 'signature'],
    asksAudience: true,
  },
  {
    value: 'school-team',
    label: 'School or team',
    namePlaceholder: 'Lincoln High Spring Formal',
    looks: ['signature', 'sharepix', 'party'],
    asksAudience: true,
  },
  {
    value: 'other',
    label: 'Something else',
    namePlaceholder: 'Our Event',
    looks: ['signature', 'sharepix', 'linen'],
  },
];

export const EVENT_TYPE_VALUES: readonly EventTypeValue[] = EVENT_TYPES.map((t) => t.value);

/** The option for a stored value, or null for an event created before the question. */
export function eventTypeFor(value: string | null | undefined): EventTypeOption | null {
  return EVENT_TYPES.find((t) => t.value === value) ?? null;
}

/** The look a new event of this type starts with. */
export function defaultLookFor(value: string | null | undefined): string {
  return eventTypeFor(value)?.looks[0] ?? 'signature';
}
