import { codeOnly, readSource } from './sourceGuards';

import {
  EVENT_NAME_UNAVAILABLE,
  PRO_QUEUES,
  PRO_STEPS,
  connectionState,
  eventLabel,
  liveState,
} from '../lib/proStatus';

/**
 * The photographer section, checked for the thing it kept failing at: telling
 * somebody what is going on.
 *
 * The event list showed raw UUIDs and a link reading "Review · paused". The
 * review page described the same state as "nothing reaches the gallery until
 * you go live". One of those explains the consequence and the other does not,
 * and a photographer had to notice they were the same state.
 */

describe('the two states read the same everywhere', () => {
  it('says what paused costs, not just that it is paused', () => {
    // The sentence that was missing. Somebody can shoot a whole ceremony,
    // approve everything, and never learn the couple has seen none of it.
    const paused = liveState(false);
    expect(paused.badge).toBe('Paused');
    // The consequence, in whatever words: nothing is visible to anybody.
    const meaning = paused.meaning.toLowerCase();
    expect(meaning).toContain('nothing');
    expect(meaning).toContain('visible');
  });

  it('labels the button with what it will do, not what is true now', () => {
    // "Paused — go live" was a status and a control in one string, and had to
    // be read as both at once.
    expect(liveState(false).action).toBe('Go live');
    expect(liveState(true).action).toBe('Pause publishing');
  });

  it('describes live from the gallery side', () => {
    expect(liveState(true).meaning.toLowerCase()).toContain('gallery');
  });
});

describe('a state with no next action is just a worry', () => {
  it('turns an invitation into something to do', () => {
    const invited = connectionState('invited');
    expect(invited.label).not.toBe('invited');
    expect(invited.detail.toLowerCase()).toContain('pairing code');
  });

  it('says what being removed does and does not undo', () => {
    expect(connectionState('removed').detail.toLowerCase()).toContain('already published stays');
  });

  it('falls back to the raw status rather than inventing one', () => {
    expect(connectionState('something_new').label).toBe('something_new');
  });
});

describe('an event has a name now', () => {
  it('uses the name when there is one', () => {
    expect(eventLabel('Sam & Riley’s Wedding')).toBe('Sam & Riley’s Wedding');
  });

  it('says what happened rather than showing an id', () => {
    // An event can be deleted while a connection to it survives. A bare UUID
    // tells a photographer nothing at all — which is what the list used to do
    // for every row, not just the deleted ones.
    expect(eventLabel(null)).toBe(EVENT_NAME_UNAVAILABLE);
    expect(eventLabel('   ')).toBe(EVENT_NAME_UNAVAILABLE);
  });
});

describe('the flow is stated once', () => {
  it('is three steps, in the order they happen', () => {
    expect(PRO_STEPS.map((step) => step.title)).toEqual(['Upload', 'Approve', 'Publish']);
  });

  it('says that nothing publishes on its own', () => {
    const text = PRO_STEPS.map((step) => step.detail).join(' ').toLowerCase();
    expect(text).toContain('nothing is automatic');
    expect(text).toContain('nobody sees them');
  });
});

describe('the queues', () => {
  it('uses the stored status as its key', () => {
    // The page filters on publishStatus. A label that drifted from the stored
    // value would show an always-empty tab and nothing would report it.
    expect(PRO_QUEUES.map((queue) => queue.key)).toEqual([
      'awaiting_review',
      'approved',
      'published',
      'rejected',
    ]);
  });

  it('calls published "In the gallery", which is what it means', () => {
    expect(PRO_QUEUES.find((queue) => queue.key === 'published')?.label).toBe('In the gallery');
  });

  it('gives every queue an empty state that says what belongs there', () => {
    // "Nothing here." was the same answer for all four.
    const messages = PRO_QUEUES.map((queue) => queue.empty);
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe('the pages read from the module', () => {
  const hub = codeOnly(readSource('pages/pro/index.tsx'));
  const review = codeOnly(readSource('pages/pro/events/[eventId]/review.tsx'));

  it('no longer prints an event id where a name belongs', () => {
    expect(hub).toContain('eventLabel(row.eventName)');
    expect(hub).not.toContain('>{row.eventId}<');
  });

  it('shows the same state sentence on both pages', () => {
    expect(hub).toContain('liveState(row.livePublishing)');
    expect(review).toContain('liveState(live)');
  });

  it('drops the count when a queue is empty', () => {
    // Four tabs all reading "(0)" is noise on a page whose job is to make the
    // state obvious at a glance.
    expect(review).toContain("counts[entry.key] ? ` (${counts[entry.key]})` : ''");
  });

  it('fetches the event name rather than leaving the list unreadable', () => {
    const api = codeOnly(readSource('lib/api.ts'));
    expect(api).toContain('eventName:');
    expect(api).toContain('models.Event.get({ id: connection.eventId }');
  });
});

describe('an event is identified by things a human has', () => {
  const hub = codeOnly(readSource('pages/pro/index.tsx'));
  const review = codeOnly(readSource('pages/pro/events/[eventId]/review.tsx'));
  const api = codeOnly(readSource('lib/api.ts'));

  it('carries the event code, which is what a host reads out', () => {
    // The three-word code is printed on the table cards and typed into /join.
    // It is the identifier a photographer can match against something the host
    // actually said to them; a UUID matches nothing a human has.
    expect(api).toContain('eventCode:');
    expect(hub).toContain('row.eventCode');
  });

  it('shows the date and the code together under the name', () => {
    expect(hub).toContain("[row.eventDate, row.eventCode].filter(Boolean).join(' · ')");
  });

  it('names the event on the review page instead of just "Review"', () => {
    // A photographer several queues deep had nothing on screen telling them
    // which wedding their approvals were landing in.
    expect(review).toContain('{event ? eventLabel(event.name) : \'Review\'}');
    expect(review).toContain('Event code {event.code}');
  });

  it('uses the UUID only as a key and a URL, never as something to read', () => {
    // It is still the identifier the routes and React need. What it must not
    // be is text on screen, which is what it was for every row.
    const uses = hub.match(/row\.eventId/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    expect(hub).toContain('key={row.eventId}');
    expect(hub).toContain('href={`/pro/events/${row.eventId}/review`}');
    // The shape it had: rendered as the content of an element.
    expect(hub).not.toContain('>{row.eventId}<');
  });
});
