import {
  DEMO_ACCEPTED_TYPES,
  DEMO_MAX_BYTES,
  DEMO_MAX_UPLOADS,
  DEMO_PREFIX,
  DEMO_PROMISE,
  DEMO_TTL_MINUTES,
  checkDemoFile,
  demoExpiresAt,
  demoKeyFor,
  demoRetentionNote,
  isDemoExpired,
  isDemoKey,
  newDemoSessionId,
} from '../lib/demoUpload';

/**
 * The demo upload is the one place a stranger can put a file into SharePix
 * without an account, from a link on the front page. These are the rules that
 * make that acceptable.
 */

const NOW = new Date('2026-09-21T12:00:00Z');

describe('what the demo accepts', () => {
  it('takes photos and not video', () => {
    // Video is not screened at all and can be 250 MB. Neither is acceptable on
    // a public target, and neither is needed to show somebody an upload.
    expect(DEMO_ACCEPTED_TYPES.every((type) => type.startsWith('image/'))).toBe(true);
    expect(checkDemoFile({ type: 'video/mp4', size: 1000 }, 0)).toEqual({
      ok: false,
      reason: expect.stringContaining('photos only'),
    });
  });

  it('caps the size below what a real event allows', () => {
    // A guest's 25 MB photo is their memory. A demo upload is deleted within
    // the hour, so there is nothing to protect by accepting one that large.
    expect(DEMO_MAX_BYTES).toBeLessThan(25 * 1024 * 1024);
    const rejection = checkDemoFile({ type: 'image/jpeg', size: DEMO_MAX_BYTES + 1 }, 0);
    expect(rejection.ok).toBe(false);
  });

  it('stops after a few, and says why in a way that sells the product', () => {
    const rejection = checkDemoFile({ type: 'image/jpeg', size: 1000 }, DEMO_MAX_UPLOADS);
    expect(rejection.ok).toBe(false);
    expect((rejection as { reason: string }).reason).toContain('Create an event');
  });

  it('accepts an ordinary phone photo', () => {
    expect(checkDemoFile({ type: 'image/jpeg', size: 4 * 1024 * 1024 }, 0)).toEqual({ ok: true });
    expect(checkDemoFile({ type: 'image/heic', size: 3 * 1024 * 1024 }, 1)).toEqual({ ok: true });
  });
});

describe('where the bytes go', () => {
  it('puts everything under one prefix', () => {
    expect(demoKeyFor('abc123', 'image/jpeg', 0).startsWith(DEMO_PREFIX)).toBe(true);
  });

  it('strips anything unexpected out of the session id', () => {
    // The session id reaches an S3 key. It is generated in the browser, so it
    // is user input by definition.
    const key = demoKeyFor('../../events/evt-1/photos/x', 'image/jpeg', 0);
    expect(key).not.toContain('..');
    expect(key).not.toContain('events/');
    expect(key.startsWith(DEMO_PREFIX)).toBe(true);
  });

  it('takes the extension from the declared type, never the filename', () => {
    expect(demoKeyFor('abc', 'image/png', 0).endsWith('.png')).toBe(true);
    expect(demoKeyFor('abc', 'image/heic', 0).endsWith('.heic')).toBe(true);
    expect(demoKeyFor('abc', 'image/jpeg', 0).endsWith('.jpg')).toBe(true);
  });

  it('gives two uploads in the same session different keys', () => {
    expect(demoKeyFor('abc', 'image/jpeg', 0)).not.toBe(demoKeyFor('abc', 'image/jpeg', 1));
  });

  it('recognises its own keys and nobody else s', () => {
    expect(isDemoKey('demo/abc/1.jpg')).toBe(true);
    // The one that matters: a real event's photo must never be swept by the
    // cleanup job because its path happens to contain the word.
    expect(isDemoKey('events/evt-1/photos/demo/1.jpg')).toBe(false);
    expect(isDemoKey('events/demo-sharepix-example/photos/1.jpg')).toBe(false);
  });

  it('makes a session id that is random and carries nothing', () => {
    const a = newDemoSessionId();
    const b = newDemoSessionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('the hour', () => {
  it('expires an upload after the stated time and not before', () => {
    const uploaded = NOW;
    const justBefore = new Date(NOW.getTime() + (DEMO_TTL_MINUTES - 1) * 60_000);
    const after = new Date(NOW.getTime() + (DEMO_TTL_MINUTES + 1) * 60_000);

    expect(isDemoExpired(uploaded, justBefore)).toBe(false);
    expect(isDemoExpired(uploaded, after)).toBe(true);
  });

  it('counts down rather than asserting once', () => {
    const expires = demoExpiresAt(NOW);
    expect(demoRetentionNote(expires, NOW)).toContain('60 minutes');
    expect(demoRetentionNote(expires, new Date(NOW.getTime() + 59 * 60_000))).toContain(
      'about a minute',
    );
  });

  it('never says zero minutes while a photo is still on screen', () => {
    const expires = demoExpiresAt(NOW);
    const nearly = new Date(expires.getTime() - 1_000);
    expect(demoRetentionNote(expires, nearly)).not.toContain('0 minutes');
  });

  it('says deleted once it is', () => {
    const expires = demoExpiresAt(NOW);
    expect(demoRetentionNote(expires, new Date(expires.getTime() + 1))).toBe('Deleted.');
  });
});

describe('what the page promises', () => {
  it('states the retention that the job actually enforces', () => {
    // The sentence and the constant live in the same file precisely so the
    // number in the copy cannot drift from the number in the sweep.
    expect(DEMO_TTL_MINUTES).toBe(60);
    expect(DEMO_PROMISE).toContain('the hour');
  });

  it('promises no read path, which is the strong part', () => {
    // Not "only you can see it" — a rule somebody has to keep enforcing — but
    // that there is nowhere to see it from at all.
    expect(DEMO_PROMISE).toContain('there is no page anywhere that shows it');
    expect(DEMO_PROMISE).toContain('not even to us');
  });

  it('does not promise deletion on leaving the page', () => {
    // It cannot be delivered on a phone, and a promise that fails quietly is
    // worse than a longer one that holds.
    expect(DEMO_PROMISE.toLowerCase()).not.toContain('when you leave');
    expect(DEMO_PROMISE.toLowerCase()).not.toContain('close the page');
  });
});
