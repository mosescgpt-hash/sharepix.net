import { readSource } from './sourceGuards';

import {
  ownerCandidatesFor,
  ownerIsSubject,
  ownerStringFor,
} from '../lib/eventOwner';
import { ownerStringFor as functionCopy } from '../amplify/functions/create-event/newEvent';

/**
 * The owner string is written by one module and read by another, and for
 * months they disagreed.
 *
 * The symptom was a global admin opening /my-events and being told they had no
 * events, with no error, while their events sat in the table. Zero rows is a
 * successful query, so nothing anywhere reported a problem.
 *
 * These tests are the two halves of making that impossible: the reader derives
 * its keys from the writer, and the writer's two copies are pinned together.
 */

const SUB = 'e4a1c0de-1111-2222-3333-444455556666';

describe('the reader and the writer agree', () => {
  it('asks for exactly what the writer writes', () => {
    // The bug, reduced. This pool signs in with email, so Cognito's username
    // is a UUID equal to the sub — the writer appends it anyway, and the old
    // reader treated "username equals sub" as "no username" and asked for a
    // bare sub that is never stored.
    const stored = ownerStringFor(SUB, SUB);
    expect(stored).toBe(`${SUB}::${SUB}`);
    expect(ownerCandidatesFor(SUB, SUB)).toContain(stored);
  });

  it('asks for what the writer writes when the username differs', () => {
    const stored = ownerStringFor(SUB, 'riley');
    expect(ownerCandidatesFor(SUB, 'riley')).toContain(stored);
  });

  it('still asks for the bare sub, for rows written without a username', () => {
    expect(ownerStringFor(SUB, '')).toBe(SUB);
    expect(ownerCandidatesFor(SUB, 'riley')).toContain(SUB);
    expect(ownerCandidatesFor(SUB, '')).toEqual([SUB]);
  });

  it('puts the shape written today first', () => {
    // Both are indexed lookups, so order is only about which one answers on
    // the first try. It should be the one this build actually writes.
    expect(ownerCandidatesFor(SUB, 'riley')[0]).toBe(`${SUB}::riley`);
  });

  it('asks for nothing at all when there is no subject', () => {
    // Never `''`, which would be a key that could match a row with an empty
    // owner rather than matching nothing.
    expect(ownerCandidatesFor('', 'riley')).toEqual([]);
    expect(ownerCandidatesFor('   ', '')).toEqual([]);
  });

  it('matches the copy the create-event function writes with', () => {
    // Amplify functions cannot import from lib/, so this rule exists twice.
    // The two disagreeing is precisely the failure above.
    for (const [sub, username] of [
      [SUB, SUB],
      [SUB, 'riley'],
      [SUB, ''],
      ['', 'riley'],
    ] as const) {
      expect(ownerStringFor(sub, username)).toBe(functionCopy(sub, username));
    }
  });
});

describe('checking a row against who asked', () => {
  it('accepts both shapes for the right subject', () => {
    expect(ownerIsSubject(SUB, SUB)).toBe(true);
    expect(ownerIsSubject(`${SUB}::riley`, SUB)).toBe(true);
    expect(ownerIsSubject(`${SUB}::${SUB}`, SUB)).toBe(true);
  });

  it('rejects somebody else', () => {
    expect(ownerIsSubject('another-sub::riley', SUB)).toBe(false);
    expect(ownerIsSubject(null, SUB)).toBe(false);
    expect(ownerIsSubject('', SUB)).toBe(false);
  });

  it('is anchored rather than a substring test', () => {
    // `includes`, which this replaced, would accept a row whose USERNAME half
    // happened to contain the caller's sub — and a global admin can read every
    // row, so that is a route to somebody else's event on the page.
    expect(ownerIsSubject(`other-sub::${SUB}`, SUB)).toBe(false);
    expect(ownerIsSubject(`prefix-${SUB}`, SUB)).toBe(false);
  });
});

describe('the page that showed nothing', () => {
  const api = readSource('lib/api.ts');

  it('derives its candidates rather than composing a string', () => {
    expect(api).toContain('return ownerCandidatesFor(user.userId, user.username);');
    expect(api).not.toContain('`${sub}::${user.username}`');
  });

  it('checks returned rows with the anchored test', () => {
    expect(api).toContain('ownerIsSubject(event.owner, user.userId)');
    expect(api).not.toContain('event.owner?.includes(user.userId)');
  });

  it('falls back for an admin who appears to own nothing', () => {
    // The index is keyed on an exact string. A row written under any shape
    // this build does not produce is invisible to it, and an admin is the one
    // caller AppSync does not rescue.
    expect(api).toContain('if (byId.size === 0)');
    expect(api).toContain('listAllEventsIfAdmin()');
  });

  it('keeps the fallback behind the empty case rather than running it always', () => {
    // It lists every event. Fine as a rescue, not as a page load.
    const fallback = api.slice(api.indexOf('async function listAllEventsIfAdmin'));
    expect(fallback.slice(0, 400)).toContain('if (!(await isGlobalAdmin())) return [];');
  });
});
