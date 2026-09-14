import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly } from './sourceGuards';
import {
  canSign,
  eventIdOfKey,
  isProKey,
  proUploadIdOf,
  variantOf,
} from '../amplify/functions/media-url/access';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const openEvent = {
  owner: 'host-sub::host@example.com',
  guestResolution: 'full' as const,
};
const guest = { sub: null, groups: [] };
const host = { sub: 'host-sub', groups: [] };
const admin = { sub: 'someone', groups: ['ADMINS'] };

const ORIGINAL = 'pro/evt1/originals/up1';
const PREVIEW = 'pro/evt1/previews/up1';
const THUMB = 'pro/evt1/thumbnails/up1';

describe('a professional original is never signed', () => {
  // Not for a guest, not for the host, not for an admin. The host bought the
  // event, not the photographer's negatives.
  it.each([
    ['a guest', guest],
    ['the host', host],
    ['an admin', admin],
  ])('refuses %s', (_who, caller) => {
    const decision = canSign({ eventId: 'evt1', key: ORIGINAL, event: openEvent, caller });
    expect(decision.allowed).toBe(false);
  });

  it('recognises the variant so the refusal is deliberate, not incidental', () => {
    // If variantOf returned 'unknown' this would still be refused, but for the
    // wrong reason — and a later prefix change could silently allow it.
    expect(variantOf(ORIGINAL)).toBe('pro-original');
    expect(variantOf(PREVIEW)).toBe('pro-preview');
    expect(variantOf(THUMB)).toBe('pro-thumb');
  });
});

describe('professional keys still belong to their event', () => {
  it('derives the event id from a pro key', () => {
    // Without this every pro key would look like another event's and be
    // refused, which fails safe but would have broken the feature silently.
    expect(eventIdOfKey(PREVIEW)).toBe('evt1');
  });

  it('refuses one event id paired with another event key', () => {
    const decision = canSign({ eventId: 'evt2', key: PREVIEW, event: openEvent, caller: guest });
    expect(decision.allowed).toBe(false);
  });
});

describe('finding the row behind a key', () => {
  it('pulls the upload id out of each variant', () => {
    for (const key of [ORIGINAL, PREVIEW, THUMB]) {
      expect(proUploadIdOf(key)).toBe('up1');
    }
  });

  it('knows a pro key from a guest one', () => {
    expect(isProKey(PREVIEW)).toBe(true);
    expect(isProKey('events/evt1/photos/a.jpg')).toBe(false);
    expect(proUploadIdOf('events/evt1/photos/a.jpg')).toBe('');
  });
});

describe('publish status gates the preview, and it is read from the row', () => {
  const handler = codeOnly(read('amplify', 'functions', 'media-url', 'handler.ts'));

  it('checks the row before signing a pro key', () => {
    // The key cannot answer this: publish status changes after the key exists.
    expect(handler).toContain('publishedProIds(keys)');
    expect(handler).toContain('isProKey(key) && !publishedPro.has(proUploadIdOf(key))');
  });

  it('only counts a row that says published', () => {
    expect(handler).toContain("row.publishStatus?.S === 'published'");
  });

  it('fails closed when the read errors', () => {
    // Showing a photographer's unreviewed work because a table read timed out
    // is the one outcome worth being blank over.
    const fn = handler.slice(handler.indexOf('async function publishedProIds'));
    expect(fn).toContain('.catch(() => null)');
    expect(fn).toContain('return published');
  });

  it('batches rather than reading per key', () => {
    // A gallery asks for hundreds of keys at once.
    expect(handler).toContain('BatchGetItemCommand');
    expect(handler).toContain('i += 100');
  });

  it('costs a guest-only gallery nothing', () => {
    // ids is empty when no pro keys were asked for, and it returns early.
    const fn = handler.slice(handler.indexOf('async function publishedProIds'));
    expect(fn).toContain('if (ids.length === 0');
  });
});

describe('the connection is the only way onto an event', () => {
  const connect = codeOnly(read('amplify', 'functions', 'connect-photographer', 'handler.ts'));

  it('derives who is asking from event ownership, never from the request', () => {
    expect(connect).toContain("owner.split('::')[0] === sub");
    expect(connect).not.toMatch(/arguments\.actor/);
  });

  it('routes every state change through actorMay', () => {
    const checks = connect.match(/actorMay\(/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });

  it('makes a pairing code single-use with a conditional write', () => {
    // Two photographers racing one code must produce one connection.
    expect(connect).toContain("ConditionExpression: 'attribute_not_exists(usedAt)'");
  });

  it('gives one answer for expired, used, and never existed', () => {
    const invalid = connect.match(/That code is not valid\./g) ?? [];
    expect(invalid.length).toBeGreaterThanOrEqual(3);
  });

  it('draws codes without modulo bias', () => {
    // A biased draw shrinks the keyspace quietly, which no shape test catches.
    expect(connect).toContain('byte >= 256 - (256 % PAIRING_ALPHABET.length)');
  });

  it('starts a new connection paused', () => {
    // Nobody gets live publishing by not deciding.
    expect(connect).toContain('livePublishing: { BOOL: false }');
  });

  it('stops publishing the moment somebody is removed', () => {
    const remove = connect.slice(connect.indexOf("action === 'remove'"));
    expect(remove).toContain("':off': { BOOL: false }");
  });
});
