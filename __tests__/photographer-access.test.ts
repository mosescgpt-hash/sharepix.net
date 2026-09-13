import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONNECTION_STATUSES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MINUTES,
  actorMay,
  canTransition,
  connectionId,
  formatPairingCode,
  mayReviewEvent,
  mayUploadToEvent,
  normalizePairingCode,
  pairingCodeUsable,
  type Actor,
  type ConnectionStatus,
} from '../lib/photographerAccess';

const EVENT = 'evt1';
const PHOTOGRAPHER = 'sub-photographer';

const accepted = { eventId: EVENT, photographerId: PHOTOGRAPHER, status: 'accepted' };

describe('a photographer can only reach an event a host put them on', () => {
  it('allows an accepted connection', () => {
    expect(mayUploadToEvent(accepted, EVENT, PHOTOGRAPHER)).toBe(true);
  });

  it('refuses every status but accepted', () => {
    for (const status of CONNECTION_STATUSES) {
      expect(mayUploadToEvent({ ...accepted, status }, EVENT, PHOTOGRAPHER)).toBe(
        status === 'accepted',
      );
    }
  });

  it('refuses a missing connection rather than assuming one', () => {
    expect(mayUploadToEvent(null, EVENT, PHOTOGRAPHER)).toBe(false);
    expect(mayUploadToEvent(undefined, EVENT, PHOTOGRAPHER)).toBe(false);
    expect(mayUploadToEvent({}, EVENT, PHOTOGRAPHER)).toBe(false);
  });

  it('blocks cross-event access', () => {
    // A row fetched by the wrong key must not authorize the event actually
    // being written to. One getItem typo away otherwise.
    expect(mayUploadToEvent(accepted, 'some-other-event', PHOTOGRAPHER)).toBe(false);
  });

  it('blocks cross-photographer access', () => {
    expect(mayUploadToEvent(accepted, EVENT, 'someone-else')).toBe(false);
  });

  it('refuses empty identifiers rather than matching on them', () => {
    // Two blank strings are equal, and that must not read as authorization.
    expect(mayUploadToEvent({ eventId: '', photographerId: '', status: 'accepted' }, '', '')).toBe(
      false,
    );
  });

  it('gates review exactly as it gates upload', () => {
    for (const status of CONNECTION_STATUSES) {
      const connection = { ...accepted, status };
      expect(mayReviewEvent(connection, EVENT, PHOTOGRAPHER)).toBe(
        mayUploadToEvent(connection, EVENT, PHOTOGRAPHER),
      );
    }
    expect(mayReviewEvent(accepted, 'other', PHOTOGRAPHER)).toBe(false);
  });

  it('keys a connection by both sides', () => {
    expect(connectionId(EVENT, PHOTOGRAPHER)).toBe(`${EVENT}#${PHOTOGRAPHER}`);
    expect(connectionId('a', 'b')).not.toBe(connectionId('b', 'a'));
  });
});

describe('a photographer can never authorize themselves', () => {
  // The invariant the whole feature rests on.
  it('does not let a photographer invite themselves', () => {
    for (const from of ['declined', 'removed'] as ConnectionStatus[]) {
      expect(actorMay('photographer', from, 'invited')).toBe(false);
      expect(actorMay('host', from, 'invited')).toBe(true);
    }
  });

  it('does not let a host accept on the photographer’s behalf', () => {
    // Accepting for someone fabricates their consent.
    expect(actorMay('host', 'invited', 'accepted')).toBe(false);
    expect(actorMay('admin', 'invited', 'accepted')).toBe(false);
    expect(actorMay('photographer', 'invited', 'accepted')).toBe(true);
  });

  it('does not let anyone jump straight to accepted', () => {
    const actors: Actor[] = ['host', 'photographer', 'admin'];
    for (const from of CONNECTION_STATUSES) {
      if (from === 'invited') continue;
      for (const actor of actors) {
        expect(actorMay(actor, from, 'accepted')).toBe(false);
      }
    }
  });

  it('lets either side end a connection', () => {
    for (const actor of ['host', 'photographer', 'admin'] as Actor[]) {
      expect(actorMay(actor, 'accepted', 'removed')).toBe(true);
    }
  });

  it('gives an admin a host’s powers and no more', () => {
    // Support, not impersonation.
    expect(actorMay('admin', 'removed', 'invited')).toBe(true);
    expect(actorMay('admin', 'invited', 'accepted')).toBe(false);
  });
});

describe('the connection state machine', () => {
  it('runs invited to accepted', () => {
    expect(canTransition('invited', 'accepted')).toBe(true);
  });

  it('treats re-inviting as a fresh invitation, not a status flip', () => {
    expect(canTransition('declined', 'invited')).toBe(true);
    expect(canTransition('removed', 'invited')).toBe(true);
    expect(canTransition('declined', 'accepted')).toBe(false);
    expect(canTransition('removed', 'accepted')).toBe(false);
  });

  it('has no transition to itself', () => {
    for (const status of CONNECTION_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('refuses a transition no actor could make anyway', () => {
    // actorMay is a narrowing of canTransition, never a widening.
    for (const from of CONNECTION_STATUSES) {
      for (const to of CONNECTION_STATUSES) {
        if (canTransition(from, to)) continue;
        for (const actor of ['host', 'photographer', 'admin'] as Actor[]) {
          expect(actorMay(actor, from, to)).toBe(false);
        }
      }
    }
  });
});

describe('pairing codes are bearer credentials', () => {
  const future = new Date('2026-06-01T12:00:00Z');
  const code = (over: Record<string, unknown> = {}) => ({
    expiresAt: '2026-06-01T12:30:00Z',
    usedAt: null,
    ...over,
  });

  it('works before it expires', () => {
    expect(pairingCodeUsable(code(), future)).toBe(true);
  });

  it('stops at expiry', () => {
    expect(pairingCodeUsable(code(), new Date('2026-06-01T12:31:00Z'))).toBe(false);
  });

  it('is single use', () => {
    // A code that attached one photographer must not attach a second.
    expect(pairingCodeUsable(code({ usedAt: '2026-06-01T12:05:00Z' }), future)).toBe(false);
  });

  it('refuses a code it cannot date, rather than accepting it', () => {
    for (const expiresAt of [null, undefined, '', 'soon']) {
      expect(pairingCodeUsable(code({ expiresAt }), future)).toBe(false);
    }
    expect(pairingCodeUsable(null, future)).toBe(false);
  });

  it('expires soon enough to be worth stealing and not worth keeping', () => {
    expect(PAIRING_CODE_TTL_MINUTES).toBeGreaterThan(0);
    expect(PAIRING_CODE_TTL_MINUTES).toBeLessThanOrEqual(60);
  });

  it('draws from an alphabet with no characters people confuse aloud', () => {
    for (const char of ['0', 'O', '1', 'I']) {
      expect(PAIRING_ALPHABET).not.toContain(char);
    }
    expect(new Set(PAIRING_ALPHABET).size).toBe(PAIRING_ALPHABET.length);
  });

  it('reads the code however it was typed', () => {
    expect(normalizePairingCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizePairingCode(' ABCD EFGH ')).toBe('ABCDEFGH');
    expect(normalizePairingCode(null)).toBe('');
    expect(normalizePairingCode('ABCDEFGHIJKLMNOP')).toHaveLength(PAIRING_CODE_LENGTH);
  });

  it('groups the code for reading aloud', () => {
    expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(formatPairingCode('ABC')).toBe('ABC');
  });
});

describe('what the schema grants', () => {
  const schema = readFileSync(join(__dirname, '..', 'amplify', 'data', 'resource.ts'), 'utf8');
  const block = (name: string) => {
    const start = schema.indexOf(`  ${name}: a\n`);
    expect(start).toBeGreaterThan(-1);
    return schema.slice(start, schema.indexOf('\n\n', schema.indexOf('.authorization', start)));
  };

  it('lets nobody create or update a connection row', () => {
    // If a photographer could write this row they could write
    // `status: accepted` for any event id they could guess, and the entire
    // authorization model would be gone. Both parties read; Lambdas write.
    const connection = block('EventPhotographer');
    expect(connection).toContain("allow.ownerDefinedIn('owner').to(['read'])");
    expect(connection).toContain("allow.ownerDefinedIn('eventOwner').to(['read'])");
    expect(connection).not.toMatch(/allow\.owner\(\)(?!\.)/);
    expect(connection).not.toContain("'create'");
    expect(connection).not.toContain("'update'");
  });

  it('makes pairing codes readable by nobody but an admin', () => {
    // A code sitting in a query result is a code that leaked. The host is
    // shown it once, by the mutation that makes it.
    const codes = block('PhotographerPairingCode');
    expect(codes).toContain("allow.group('ADMINS')");
    expect(codes).not.toContain('allow.owner');
    expect(codes).not.toContain('allow.authenticated');
    expect(codes).not.toContain('allow.guest');
  });

  it('lets a photographer keep their own profile and nobody enumerate them', () => {
    const profile = block('PhotographerProfile');
    expect(profile).toContain('allow.owner()');
    expect(profile).not.toContain('allow.authenticated');
    expect(profile).not.toContain('allow.guest');
  });
});
