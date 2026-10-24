import {
  MAX_PHOTOS_PER_CALL,
  MAX_RECIPIENTS,
  applyAssignment,
  isAssignAction,
  matchAfter,
  recipientsOf,
} from '../amplify/functions/booth-scan/recipients';
import { boothGroups } from '../lib/boothGroups';
import { codeOnly, readSource } from './sourceGuards';

const alex = { id: 'a', name: 'Alex' };
const bea = { id: 'b', name: 'Bea' };

describe('fix-up rules', () => {
  it('moves, adds, removes and clears', () => {
    expect(applyAssignment([alex], 'set', bea)).toEqual([bea]);
    expect(applyAssignment([alex], 'add', bea)).toEqual([alex, bea]);
    expect(applyAssignment([alex, bea], 'remove', alex)).toEqual([bea]);
    expect(applyAssignment([alex, bea], 'clear', null)).toEqual([]);
  });

  it('never adds someone twice, or past the group-shot limit', () => {
    expect(applyAssignment([alex], 'add', alex)).toEqual([alex]);
    const full = Array.from({ length: MAX_RECIPIENTS }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(applyAssignment(full, 'add', bea)).toHaveLength(MAX_RECIPIENTS);
  });

  it('reads step 2 rows and step 3 rows alike', () => {
    expect(recipientsOf({ id: 'a', name: 'Alex' })).toEqual([alex]);
    expect(recipientsOf({ ids: ['a', 'b'], names: ['Alex', 'Bea'], id: 'a', name: 'Alex' })).toEqual([alex, bea]);
    expect(recipientsOf({})).toEqual([]);
  });

  it('accepts only the four actions', () => {
    expect(isAssignAction('set')).toBe(true);
    expect(isAssignAction('publish')).toBe(false);
  });
});

describe('grouping', () => {
  const assignments = new Map([
    ['p1', { attendeeIds: ['a'], attendeeNames: ['Alex'], match: 'capture' }],
    ['p2', { attendeeIds: ['a', 'b'], attendeeNames: ['Alex', 'Bea'], match: 'manual' }],
    ['p3', { attendeeIds: ['b'], attendeeNames: ['Bea'], match: 'upload' }],
    ['p4', { attendeeIds: [], attendeeNames: [], match: 'unassigned' }],
  ]);

  it('puts check and unmatched first, then people in scan order, group shots under each', () => {
    const groups = boothGroups(['p1', 'p2', 'p3', 'p4', 'p5'], assignments, [
      { attendeeId: 'b', name: 'Bea' },
      { attendeeId: 'a', name: 'Alex' },
    ]);
    expect(groups.map((g) => [g.key, g.photoIds])).toEqual([
      ['check', ['p3']],
      ['none', ['p4', 'p5']],
      ['b', ['p2', 'p3']],
      ['a', ['p1', 'p2']],
    ]);
  });
});

describe('the server keeps the fix-ups honest', () => {
  const handler = codeOnly(readSource('amplify/functions/booth-scan/handler.ts'));

  it('only changes the photographer\'s own booth photos at this event', () => {
    expect(handler).toContain('item.photographerId?.S !== sub');
    expect(handler).toContain('item.eventId?.S !== eventId');
    expect(handler).toContain('item.boothMatch?.S === undefined');
    expect(handler).toContain("ConditionExpression: 'photographerId = :sub'");
  });

  it('only assigns people who signed up for this event', () => {
    expect(handler).toContain('item.eventId?.S !== eventId) return null;');
  });

  it('limits a batch', () => {
    expect(MAX_PHOTOS_PER_CALL).toBe(100);
    expect(handler).toContain('ids.length > MAX_PHOTOS_PER_CALL');
  });

  it('marks a fixed photo as manual, so it leaves the check group', () => {
    expect(handler).toContain("':match': { S: matchAfter(action, next.length) }");
    expect(matchAfter('add', 1)).toBe('manual');
    expect(matchAfter('remove', 0)).toBe('unassigned');
  });
});
