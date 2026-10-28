import { readFileSync } from 'fs';
import {
  GUEST_LONG_EDGE,
  MAX_BACKLOG,
  canvasToJpeg,
  captureSize,
  createUploadQueue,
  personalPageUrl,
} from '../lib/boothCapture';
import { BOOTH_LINK_BASE, boothLink, boothPayloadOf, readBoothLink } from '../lib/boothLink';
import { tokenFromBoothQr } from '../lib/booth';
import {
  GUEST_UPLOAD_MESSAGES,
  MAX_GUEST_UPLOADS,
  guestUploadRefusal,
  isControlPayload,
} from '../amplify/functions/booth-scan/boothControl';

const CONTROL = 'SPK1.e.-.AbCdEf123456';
const jpeg = (n = 500) => Buffer.from([0xff, 0xd8, 0xff, ...new Array(n).fill(1)]);

describe('start/stop codes are links, not raw strings (the reported bug)', () => {
  it('wraps a control code in a sharepix.net link a phone camera can open', () => {
    const link = boothLink('evt1', CONTROL);
    expect(link).toBe(`${BOOTH_LINK_BASE}evt1/${CONTROL}`);
    expect(link.startsWith('https://')).toBe(true);
  });
  it('reads the code back out of the link, for scanning and for divider photos', () => {
    const link = boothLink('evt1', CONTROL);
    expect(readBoothLink(link)).toEqual({ eventId: 'evt1', payload: CONTROL });
    expect(boothPayloadOf(link, 'evt1')).toBe(CONTROL);
    expect(isControlPayload(boothPayloadOf(link, 'evt1') ?? '')).toBe(true);
    expect(tokenFromBoothQr(link)).toBe(CONTROL);
  });
  it('never lets another event’s link act as this event’s code', () => {
    expect(boothPayloadOf(boothLink('other', CONTROL), 'evt1')).toBeNull();
  });
  it('still reads old printed codes (a bare SPK1 string)', () => {
    expect(boothPayloadOf(CONTROL, 'evt1')).toBe(CONTROL);
    expect(tokenFromBoothQr(CONTROL)).toBe(CONTROL);
  });
  it('still rejects other inner shapes', () => {
    expect(readBoothLink(`${BOOTH_LINK_BASE}evt1/whatever`)).toBeNull();
    expect(readBoothLink(`${BOOTH_LINK_BASE}evt1/t.short`)).toBeNull();
  });
});

describe('the guest photo cap', () => {
  it('is far above a booth session and still a hard stop', () => {
    expect(MAX_GUEST_UPLOADS).toBeGreaterThanOrEqual(1000);
    const base = { sessionAt: '2026-01-01T00:00:00Z', uploadsClosed: false, bytes: jpeg() };
    expect(guestUploadRefusal({ ...base, count: 51 })).toBeNull();
    expect(guestUploadRefusal({ ...base, count: 400 })).toBeNull();
    expect(guestUploadRefusal({ ...base, count: MAX_GUEST_UPLOADS })).toBe('limit');
    expect(GUEST_UPLOAD_MESSAGES.limit).toMatch(/most photos/);
  });
  it('still closes on host/stop and still wants a session', () => {
    expect(guestUploadRefusal({ sessionAt: 'x', uploadsClosed: true, count: 0, bytes: jpeg() })).toBe('closed');
    expect(guestUploadRefusal({ sessionAt: null, uploadsClosed: false, count: 0, bytes: jpeg() })).toBe('not-scanned');
  });
  it('is the same in all three functions', () => {
    const a = readFileSync('amplify/functions/booth-gallery/boothControl.ts', 'utf8');
    for (const fn of ['booth-scan', 'process-pro-photo']) {
      expect(readFileSync(`amplify/functions/${fn}/boothControl.ts`, 'utf8')).toBe(a);
    }
  });
});

describe('guest scan starts the photo session (booth-gallery)', () => {
  const src = readFileSync('amplify/functions/booth-gallery/handler.ts', 'utf8');
  const fn = src.slice(src.indexOf('async function guestLink'), src.indexOf('function offlineId'));
  it('records the session only the first time, with no start code needed', () => {
    expect(fn).toContain('if_not_exists(boothSessionAt');
    expect(fn).toContain("!attendee.boothSessionAt?.S");
  });
  it('sets the session after the same checks as before (offline code needs a photographed person)', () => {
    expect(fn.indexOf('ids.has(opened.personId)')).toBeLessThan(fn.indexOf('if_not_exists(boothSessionAt'));
    expect(fn.indexOf("return fail;")).toBeLessThan(fn.indexOf('if_not_exists(boothSessionAt'));
  });
  it('answers a host control code link in plain words, with no key', async () => {
    const { handler } = await import('../amplify/functions/booth-gallery/handler');
    const res = (await handler({
      arguments: { code: boothLink('evt1', CONTROL) },
      fieldName: 'boothGuestLink',
    })) as { ok: boolean; message: string; key: string | null };
    expect(res.ok).toBe(false);
    expect(res.key).toBeNull();
    expect(res.message).toMatch(/control code for the host or photographer/);
    expect(res.message).not.toContain('SPK1');
  });
});

describe('capture helpers', () => {
  it('shrinks the longest edge to 2000 and keeps the ratio', () => {
    expect(captureSize(4000, 3000)).toEqual({ width: GUEST_LONG_EDGE, height: 1500 });
    expect(captureSize(1080, 1920)).toEqual({ width: 1080, height: 1920 });
    expect(captureSize(3000, 4000)).toEqual({ width: 1500, height: GUEST_LONG_EDGE });
    expect(captureSize(0, 0)).toEqual({ width: 1, height: 1 });
  });
  it('lowers JPEG quality until it fits the 700 KB limit', () => {
    const calls: number[] = [];
    const out = canvasToJpeg({
      toDataURL: (_t, q) => {
        calls.push(q ?? 0);
        return q && q > 0.6 ? 'x'.repeat(1_200_000) : 'ok';
      },
    });
    expect(out).toBe('ok');
    expect(calls).toEqual([0.85, 0.75, 0.6]);
  });
  it('builds the personal page link', () => {
    expect(personalPageUrl('https://www.sharepix.net/', 'k_1')).toBe('https://www.sharepix.net/booth/photos/k_1');
  });
});

describe('background upload queue', () => {
  const nosleep = () => Promise.resolve();

  it('uploads every shot in order with no limit on how many are taken in a session', async () => {
    const sent: string[] = [];
    const q = createUploadQueue({
      send: async (i) => (sent.push(i), { ok: true, message: '' }),
      sleep: nosleep,
    });
    for (let n = 0; n < 120; n += 1) {
      expect(q.add(`p${n}`)).toBe(true);
      if (n % 10 === 0) await q.idle(); // the phone catches up as shots are taken
    }
    await q.idle();
    expect(sent).toHaveLength(120);
    expect(sent[0]).toBe('p0');
    expect(sent[119]).toBe('p119');
    expect(q.state()).toEqual({ sent: 120, waiting: 0, failed: 0, stopped: null });
  });

  it('stops and keeps the rest when the server says uploads are closed', async () => {
    let n = 0;
    const q = createUploadQueue({
      send: async () => (++n <= 2 ? { ok: true, message: '' } : { ok: false, message: 'Uploads for this event are closed. Thanks for sharing!' }),
      sleep: nosleep,
    });
    for (let i = 0; i < 5; i += 1) q.add(`p${i}`);
    await q.idle();
    const s = q.state();
    expect(s.sent).toBe(2);
    expect(s.stopped).toMatch(/closed/);
    expect(s.failed).toBe(3);
    expect(q.add('more')).toBe(false);
  });

  it('retries a flaky connection, then keeps photos for a manual retry', async () => {
    let online = false;
    const calls: string[] = [];
    const q = createUploadQueue({
      send: async (i) => {
        calls.push(i);
        if (!online) throw new Error('offline');
        return { ok: true, message: '' };
      },
      retries: 2,
      sleep: nosleep,
    });
    q.add('a');
    q.add('b');
    await q.idle();
    expect(calls).toEqual(['a', 'a', 'a']); // 1 try + 2 retries, then it stops hammering
    expect(q.state()).toMatchObject({ sent: 0, waiting: 0, failed: 2, stopped: null });
    online = true;
    q.retryFailed();
    await q.idle();
    expect(q.state()).toEqual({ sent: 2, waiting: 0, failed: 0, stopped: null });
  });

  it('survives a drop in the middle of a photo', async () => {
    let n = 0;
    const q = createUploadQueue({
      send: async () => {
        n += 1;
        if (n === 1) throw new Error('blip');
        return { ok: true, message: '' };
      },
      sleep: nosleep,
    });
    q.add('a');
    await q.idle();
    expect(q.state().sent).toBe(1);
  });

  it('makes the shutter wait when too many photos are stuck unsent', async () => {
    const q = createUploadQueue({ send: async () => { throw new Error('offline'); }, retries: 0, sleep: nosleep });
    for (let i = 0; i < MAX_BACKLOG; i += 1) q.add(`p${i}`);
    await q.idle();
    expect(q.canAdd()).toBe(false);
    expect(q.add('one more')).toBe(false);
  });
});
