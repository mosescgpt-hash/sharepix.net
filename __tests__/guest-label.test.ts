import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guestLabelFor, isGuestLabel, mintGuestLabel } from '../lib/guestLabel';
import { contributorKey } from '../lib/successfulEvent';

/** A localStorage stand-in, since these tests run in the node project. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    size: () => store.size,
    keys: () => [...store.keys()],
  };
}

function withStorage(storage: unknown) {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('minting a label', () => {
  it('looks like a label a person could read out', () => {
    for (let i = 0; i < 50; i += 1) {
      const label = mintGuestLabel();
      expect(label).toMatch(/^Guest [A-Z2-9]{4}$/);
      expect(isGuestLabel(label)).toBe(true);
    }
  });

  it('avoids characters that are misread aloud', () => {
    // O/0, I/1 and S/5 are the pairs people get wrong when reading a code to
    // someone else, and a guest label ends up spoken at a party.
    const labels = Array.from({ length: 200 }, () => mintGuestLabel()).join('');
    for (const banned of ['O', '0', 'I', '1', 'S', '5']) {
      expect(labels).not.toContain(banned);
    }
  });

  it('is different nearly every time', () => {
    // Not a uniqueness guarantee — 29^4 is about 700k, so a collision at one
    // event is possible and harmless (two guests share a label and count as
    // one contributor, which undercounts). This only catches a constant.
    const labels = new Set(Array.from({ length: 200 }, () => mintGuestLabel()));
    expect(labels.size).toBeGreaterThan(150);
  });

  it('rejects anything that is not one of ours', () => {
    for (const value of ['', 'Guest', 'Guest ABC', 'Guest ABCDE', 'guest ABCD', 'Anonymous', null]) {
      expect(isGuestLabel(value)).toBe(false);
    }
    // Right shape, wrong alphabet: 0 and I are not in it.
    expect(isGuestLabel('Guest 0IAB')).toBe(false);
  });
});

describe('reusing a label', () => {
  it('gives the same browser the same label at the same event', () => {
    withStorage(fakeStorage());
    const first = guestLabelFor('evt-1');
    expect(guestLabelFor('evt-1')).toBe(first);
    expect(guestLabelFor('evt-1')).toBe(first);
  });

  it('gives the same browser a different label at a different event', () => {
    // Scoped per event deliberately: one browser-wide id would build a
    // cross-event identifier for people who never made an account and were
    // never asked.
    withStorage(fakeStorage());
    expect(guestLabelFor('evt-1')).not.toBe(guestLabelFor('evt-2'));
  });

  it('stores one entry per event, under a namespaced key', () => {
    const storage = fakeStorage();
    withStorage(storage);
    guestLabelFor('evt-1');
    guestLabelFor('evt-2');
    expect(storage.size()).toBe(2);
    for (const key of storage.keys()) {
      expect(key.startsWith('sharepix.guest-label.')).toBe(true);
    }
  });

  it('replaces a stored value that is not a label', () => {
    // Something else wrote to the key, or an older format is present.
    const storage = fakeStorage({ 'sharepix.guest-label.evt-1': 'Anonymous' });
    withStorage(storage);
    expect(isGuestLabel(guestLabelFor('evt-1'))).toBe(true);
  });
});

describe('when storage is unusable', () => {
  it('still returns a working label rather than failing the upload', () => {
    // Some privacy modes throw on access rather than returning null. A guest
    // at a party must never be refused because their browser locked storage
    // down; they simply may appear as more than one contributor.
    withStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(isGuestLabel(guestLabelFor('evt-1'))).toBe(true);
  });

  it('still returns a label when only writing fails', () => {
    withStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(isGuestLabel(guestLabelFor('evt-1'))).toBe(true);
  });
});

describe('labels feed contributor counting', () => {
  it('produces a key that counts as somebody', () => {
    // The whole point: an unnamed guest used to become "Anonymous", which
    // contributorKey deliberately refuses to count. A label does count.
    expect(contributorKey('Anonymous')).toBeNull();
    expect(contributorKey(mintGuestLabel())).not.toBeNull();
  });

  it('makes two unnamed guests two contributors, not one', () => {
    const alice = fakeStorage();
    const bob = fakeStorage();
    withStorage(alice);
    const aliceLabel = guestLabelFor('evt-1');
    withStorage(bob);
    const bobLabel = guestLabelFor('evt-1');
    expect(contributorKey(aliceLabel)).not.toBe(contributorKey(bobLabel));
  });
});

describe('the upload form no longer promises something that does not happen', () => {
  const form = readFileSync(join(__dirname, '..', 'components', 'UploadForm.tsx'), 'utf8');

  it('still tells guests a blank name gets a reusable label', () => {
    // This sentence shipped long before the behaviour did. It is true now, and
    // this fails if the label mechanism is removed while the copy stays.
    expect(form).toMatch(/reusable guest label/i);
  });

  it('is backed by lib/api.ts actually calling for one', () => {
    const api = readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8');
    expect(api).toContain('guestLabelFor(eventId)');
    // The old fallback must not still be the one in the upload path.
    expect(api).not.toContain("|| 'Anonymous')");
  });
});
