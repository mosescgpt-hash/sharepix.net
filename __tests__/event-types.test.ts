import { EVENT_TYPES, EVENT_TYPE_VALUES, defaultLookFor, eventTypeFor } from '../lib/eventTypes';
import { STARTER_LOOKS, starterLookFor } from '../lib/starterLooks';
import { SURVEY_QUESTIONS } from '../lib/survey';
import { IMAGE_SLOTS } from '../lib/imagery';
import {
  EVENT_TYPE_VALUES as FUNCTION_EVENT_TYPES,
  normalizeEventType,
} from '../amplify/functions/create-event/newEvent';
import { codeOnly, readSource } from './sourceGuards';

/**
 * The event type a host picks first, and everything it steers.
 *
 * Three copies of one list have to agree: the picker (lib/eventTypes.ts), the
 * survey that already asks the same question, and the create-event function
 * that decides what is stored. A value only one of them knows is either a tile
 * that silently stores nothing or a survey answer no event can carry.
 */
describe('event types', () => {
  it('match the survey question one for one', () => {
    const survey = SURVEY_QUESTIONS.find((q) => q.id === 'eventType');
    const surveyValues = (survey?.options ?? []).map((o) => o.value).sort();
    expect([...EVENT_TYPE_VALUES].sort()).toEqual(surveyValues);
  });

  it('match the create-event function’s copy', () => {
    expect([...FUNCTION_EVENT_TYPES].sort()).toEqual([...EVENT_TYPE_VALUES].sort());
  });

  it('suggest only looks that exist, and at least one', () => {
    for (const type of EVENT_TYPES) {
      expect(type.looks.length).toBeGreaterThan(0);
      for (const key of type.looks) {
        expect({ type: type.value, look: key, exists: Boolean(starterLookFor(key)) }).toEqual({
          type: type.value,
          look: key,
          exists: true,
        });
      }
    }
  });

  it('use only image slots the site has', () => {
    for (const type of EVENT_TYPES) {
      if (type.image) expect(IMAGE_SLOTS).toContain(type.image);
    }
  });

  it('start an event with no type on the Signature look', () => {
    expect(defaultLookFor(null)).toBe('signature');
    expect(defaultLookFor('nonsense')).toBe('signature');
    expect(starterLookFor('signature')).not.toBeNull();
    expect(defaultLookFor('wedding')).toBe(eventTypeFor('wedding')!.looks[0]);
  });

  it('keep look keys unique', () => {
    expect(new Set(STARTER_LOOKS.map((l) => l.key)).size).toBe(STARTER_LOOKS.length);
  });
});

describe('normalizeEventType', () => {
  it('keeps a known value, whatever its case and spacing', () => {
    expect(normalizeEventType(' Wedding ')).toBe('wedding');
    expect(normalizeEventType('family-reunion')).toBe('family-reunion');
  });

  it('drops anything else rather than storing it', () => {
    expect(normalizeEventType('<script>')).toBeNull();
    expect(normalizeEventType('')).toBeNull();
    expect(normalizeEventType(undefined)).toBeNull();
    expect(normalizeEventType(null)).toBeNull();
  });

  it('is what the handler writes', () => {
    const handler = codeOnly(readSource('amplify/functions/create-event/handler.ts'));
    expect(handler).toContain('normalizeEventType(event.arguments.eventType)');
  });
});

describe('the create-event page', () => {
  const PAGE = codeOnly(readSource('pages/create-event.tsx'));

  it('asks the event type before anything else', () => {
    expect(PAGE).toContain('What are you celebrating?');
    expect(PAGE.indexOf('What are you celebrating?')).toBeLessThan(PAGE.indexOf('id="event-name"'));
  });

  it('sends the type and applies the look once the event exists', () => {
    expect(PAGE).toContain('eventType: eventType?.value');
    expect(PAGE.indexOf('createNewEvent(')).toBeLessThan(PAGE.indexOf('applyStarterLook('));
    // Before checkout, so a host who pays comes back to a styled gallery.
    expect(PAGE.indexOf('applyStarterLook(')).toBeLessThan(PAGE.indexOf('startCheckout('));
  });
});
