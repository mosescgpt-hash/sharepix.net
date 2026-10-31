import {
  LOG_CODES,
  MAX_ENTRIES,
  MAX_BATCH_CHARS,
  isLogId,
  normalizeSupportCode,
  problemCount,
  sanitizeBatch,
  scrubRoute,
  scrubText,
  supportCode,
} from '../lib/clientLogSchema';

/**
 * What may be stored from a device's log, and what is cut before it is.
 *
 * The server runs all of this again on arrival (the browser is not trusted), so
 * these are the tests that say what "never contains a secret" means in practice.
 */

const ID = 'ABCDEFGHJKMNPQRSTVWX'; // 20 characters from the id alphabet
const SESSION = 'XWVTSRQPNMKJHGFEDCBA';

function batch(entries: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ deviceId: ID, sessionId: SESSION, entries, ...extra });
}

describe('scrubText', () => {
  it('removes a whole URL, host and all', () => {
    expect(scrubText('failed https://bucket.s3.amazonaws.com/a/b.jpg?X-Amz-Signature=abc123 twice')).toBe(
      'failed [url] twice',
    );
  });

  it('cuts everything after a # wherever it appears', () => {
    expect(scrubText('opened /event/x#k=SECRETKEYVALUE')).toBe('opened /event/x');
    expect(scrubText('see #k=abc and more')).toBe('see and more');
  });

  it('removes signed query parameters that are not inside a URL', () => {
    expect(scrubText('retry X-Amz-Signature=deadbeef&other')).not.toMatch(/deadbeef/);
    expect(scrubText('key=hunter2')).not.toMatch(/hunter2/);
  });

  it('removes email addresses', () => {
    expect(scrubText('sent to guest@example.com failed')).toBe('sent to [email] failed');
  });

  it('replaces long token-like runs, such as a JWT or link key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    expect(scrubText(`bad ${jwt}`)).toBe('bad [token]');
    expect(scrubText('AKIAABCDEFGHIJKLMNOP')).toBe('[token]');
  });

  it('strips control characters and caps the length', () => {
    expect(scrubText('a\u0000b\nc')).toBe('a b c');
    expect(scrubText('x'.repeat(500)).length).toBeLessThanOrEqual(120);
    expect(scrubText(42)).toBe('');
  });
});

describe('scrubRoute', () => {
  it('keeps the path and drops the query and the fragment', () => {
    expect(scrubRoute('/event/x/upload?name=Sam#k=SECRET')).toBe('/event/x/upload');
  });

  it('turns id-shaped segments into :id', () => {
    expect(scrubRoute('/event/ab12cd34ef56gh78/live')).toBe('/event/:id/live');
    expect(scrubRoute('/event/[eventId]/live')).toBe('/event/:id/live');
  });

  it('never keeps a full URL', () => {
    expect(scrubRoute('https://sharepix.net/privacy?x=1')).not.toMatch(/sharepix\.net|\?|x=1/);
  });
});

describe('support codes', () => {
  it('shows the first eight characters of the id in two groups', () => {
    expect(supportCode(ID)).toBe('ABCD-EFGH');
  });

  it('reads back whatever a person typed', () => {
    expect(normalizeSupportCode('abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeSupportCode('a b c d e f g h i j')).toBe('ABCDEFGH');
  });

  it('accepts only well-formed ids', () => {
    expect(isLogId(ID)).toBe(true);
    expect(isLogId('short')).toBe(false);
    expect(isLogId(`${ID}X`)).toBe(false);
    expect(isLogId('ABCDEFGHJKMNPQRSTVW0')).toBe(false);
    expect(isLogId(12345)).toBe(false);
  });
});

describe('sanitizeBatch', () => {
  it('accepts a well-formed batch and returns cleaned values', () => {
    const out = sanitizeBatch(
      batch([{ t: 10, c: 'upload_fail', d: 'saw https://x.test/a?sig=1', r: '/event/x/upload?name=Sam#k=z', n: 3 }], {
        build: 'abc1234',
        device: { b: 'Safari 17', os: 'iOS 17', w: 390, h: 844 },
      }),
    );
    expect(out).not.toBeNull();
    expect(out?.entries[0]).toEqual({ t: 10, c: 'upload_fail', d: 'saw [url]', r: '/event/x/upload', n: 3 });
    expect(out?.build).toBe('abc1234');
    expect(out?.device).toEqual({ b: 'Safari 17', os: 'iOS 17', w: 390, h: 844 });
  });

  it('refuses malformed JSON, bad ids and empty batches', () => {
    expect(sanitizeBatch('not json')).toBeNull();
    expect(sanitizeBatch(undefined)).toBeNull();
    expect(sanitizeBatch(JSON.stringify({ deviceId: 'x', sessionId: SESSION, entries: [{ c: 'route_view' }] }))).toBeNull();
    expect(sanitizeBatch(batch([]))).toBeNull();
  });

  it('refuses an oversized batch', () => {
    expect(sanitizeBatch('x'.repeat(MAX_BATCH_CHARS + 1))).toBeNull();
  });

  it('drops entries whose code is not in the vocabulary, keeping the rest', () => {
    const out = sanitizeBatch(batch([{ c: 'steal_photos' }, { c: 'route_view', r: '/' }]));
    expect(out?.entries.map((e) => e.c)).toEqual(['route_view']);
    expect(sanitizeBatch(batch([{ c: 'steal_photos' }]))).toBeNull();
  });

  it('stores at most MAX_ENTRIES entries', () => {
    const many = Array.from({ length: MAX_ENTRIES + 10 }, () => ({ c: 'route_view', r: '/' }));
    expect(sanitizeBatch(batch(many))?.entries).toHaveLength(MAX_ENTRIES);
  });

  it('ignores a build that is not a commit-like label, and unknown device fields', () => {
    const out = sanitizeBatch(
      batch([{ c: 'route_view', r: '/' }], { build: 'https://evil.test', device: { ip: '1.2.3.4', name: 'Sam' } }),
    );
    expect(out?.build).toBeUndefined();
    expect(out?.device).toBeUndefined();
  });

  it('clamps an entry age, so a wrong clock cannot place it in the distant past', () => {
    const out = sanitizeBatch(batch([{ c: 'route_view', t: 10 ** 15 }, { c: 'route_view', t: -5 }]));
    expect(out?.entries[0].t).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    expect(out?.entries[1].t).toBe(0);
  });
});

describe('problemCount', () => {
  it('counts warnings and errors, not information', () => {
    const entries = [
      { t: 0, c: 'route_view' as const },
      { t: 0, c: 'upload_fail' as const },
      { t: 0, c: 'net_offline' as const },
    ];
    expect(LOG_CODES.route_view).toBe('info');
    expect(problemCount(entries)).toBe(2);
  });
});
