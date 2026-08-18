import { createSignedUrlCache } from '../lib/signedUrlCache';

const TTL = 10 * 60 * 1000;

/** A signer that hands back a different URL every call, like a real signature. */
function countingSigner() {
  let calls = 0;
  return {
    calls: () => calls,
    sign: async (path: string) => {
      calls += 1;
      return `https://s3/${path}?sig=${calls}`;
    },
  };
}

describe('signed URL reuse', () => {
  it('signs a path once and reuses it inside the TTL', () => {
    // The whole point: a new signature is a new URL, and a new URL means the
    // browser re-downloads a file it already has.
    let now = 1_000_000;
    const signer = countingSigner();
    const cache = createSignedUrlCache(signer.sign, TTL, 2000, () => now);

    return cache
      .get('events/e1/photos/clip.mov')
      .then(async (first) => {
        now += TTL - 1;
        const second = await cache.get('events/e1/photos/clip.mov');
        expect(second).toBe(first);
        expect(signer.calls()).toBe(1);
      });
  });

  it('re-signs once the TTL has passed', async () => {
    let now = 1_000_000;
    const signer = countingSigner();
    const cache = createSignedUrlCache(signer.sign, TTL, 2000, () => now);

    const first = await cache.get('a.jpg');
    now += TTL;
    const second = await cache.get('a.jpg');
    expect(second).not.toBe(first);
    expect(signer.calls()).toBe(2);
  });

  it('keeps paths separate', async () => {
    const signer = countingSigner();
    const cache = createSignedUrlCache(signer.sign, TTL);
    const [a, b] = await Promise.all([cache.get('a.jpg'), cache.get('b.jpg')]);
    expect(a).not.toBe(b);
    expect(signer.calls()).toBe(2);
  });

  it('signs a path once when a gallery asks for it many times at once', async () => {
    // A render that resolves the same path in parallel should produce one
    // request, not one per caller.
    const signer = countingSigner();
    const cache = createSignedUrlCache(signer.sign, TTL);
    const urls = await Promise.all(Array.from({ length: 20 }, () => cache.get('same.jpg')));
    expect(new Set(urls).size).toBe(1);
    expect(signer.calls()).toBe(1);
  });

  it('does not wedge a path after a signing failure', async () => {
    // An in-flight entry that outlived its rejection would make every later
    // call for that path reject forever.
    let fail = true;
    const cache = createSignedUrlCache(
      async (path: string) => {
        if (fail) throw new Error('no credentials');
        return `https://s3/${path}`;
      },
      TTL,
    );

    await expect(cache.get('a.jpg')).rejects.toThrow('no credentials');
    fail = false;
    await expect(cache.get('a.jpg')).resolves.toBe('https://s3/a.jpg');
  });

  it('stays bounded on a long session over a large event', async () => {
    let now = 1_000_000;
    const signer = countingSigner();
    const cache = createSignedUrlCache(signer.sign, TTL, 50, () => now);
    for (let i = 0; i < 500; i += 1) {
      now += 1000; // ~8 minutes total, so nothing expires on time alone
      await cache.get(`photo-${i}.jpg`);
    }
    expect(cache.size()).toBeLessThanOrEqual(50);
  });

  it('clear() drops everything, so new credentials re-sign', async () => {
    const signer = countingSigner();
    const cache = createSignedUrlCache(signer.sign, TTL);
    await cache.get('a.jpg');
    cache.clear();
    await cache.get('a.jpg');
    expect(signer.calls()).toBe(2);
  });
});
