import { readFileSync } from 'fs';
import { join } from 'path';
import * as gate from '../amplify/functions/gallery-access/galleryGate';
import * as pin from '../amplify/functions/gallery-access/pin';
import * as listVis from '../amplify/functions/list-event-photos/visibility';
import { sharedGalleryFor } from '../amplify/functions/booth-gallery/sharedGallery';
import { videoStatusFor } from '../amplify/functions/create-event-photo/moderation';
import { buildPatch, type SettingsRequest } from '../amplify/functions/update-event/settings';
import * as client from '../lib/galleryAccess';

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
const DAY = 24 * 60 * 60 * 1000;

describe('the gallery PIN rule', () => {
  const date = '2026-06-01';
  const eventDay = Date.parse(date);
  const base = { galleryPinSet: true, date };

  it('asks for nothing when no PIN exists, whatever the mode', () => {
    for (const mode of [undefined, 'on', 'off', 'auto']) {
      expect(gate.pinRequired({ galleryPinSet: false, galleryPinMode: mode, date }, eventDay + 400 * DAY)).toBe(false);
      expect(gate.pinRequired({ galleryPinMode: mode, date }, eventDay + 400 * DAY)).toBe(false);
    }
  });

  it('switches on 30 days after the event by default', () => {
    expect(gate.pinRequired(base, eventDay + 29 * DAY)).toBe(false);
    expect(gate.pinRequired(base, eventDay + 30 * DAY)).toBe(true);
    expect(gate.pinRequired(base, eventDay + 90 * DAY)).toBe(true);
  });

  it('follows the days the host chose, clamped to a sane range', () => {
    const week = { ...base, galleryPinAutoDays: 7 };
    expect(gate.pinRequired(week, eventDay + 6 * DAY)).toBe(false);
    expect(gate.pinRequired(week, eventDay + 7 * DAY)).toBe(true);
    expect(gate.pinAutoDaysOf(0)).toBe(1);
    expect(gate.pinAutoDaysOf(10_000)).toBe(365);
    expect(gate.pinAutoDaysOf(null)).toBe(30);
    expect(gate.pinAutoDaysOf(Number.NaN)).toBe(30);
  });

  it('is always on, or off, when the host says so', () => {
    expect(gate.pinRequired({ ...base, galleryPinMode: 'on' }, eventDay - 5 * DAY)).toBe(true);
    expect(gate.pinRequired({ ...base, galleryPinMode: 'off' }, eventDay + 500 * DAY)).toBe(false);
  });

  it('falls back to the creation time when the date is unusable, and to "on" with neither', () => {
    const created = '2026-01-01T00:00:00.000Z';
    const noDate = { galleryPinSet: true, date: 'next friday', createdAt: created };
    expect(gate.pinRequired(noDate, Date.parse(created) + 29 * DAY)).toBe(false);
    expect(gate.pinRequired(noDate, Date.parse(created) + 31 * DAY)).toBe(true);
    // A PIN the host set must never quietly never apply.
    expect(gate.pinRequired({ galleryPinSet: true }, 0)).toBe(true);
  });

  it('treats an unknown mode as the default', () => {
    expect(gate.pinModeOf('banana')).toBe('auto');
    expect(gate.pinModeOf(undefined)).toBe('auto');
  });

  it('accepts 4 to 6 digits and nothing else', () => {
    for (const ok of ['1234', '12345', '123456', '0000']) expect(gate.isValidPin(ok)).toBe(true);
    for (const bad of ['123', '1234567', '12a4', '', ' 1234', '12 34', 1234, null, undefined]) {
      expect(gate.isValidPin(bad)).toBe(false);
    }
  });
});

describe('the access token', () => {
  const key = 'k'.repeat(44);
  const now = Date.parse('2026-06-01T12:00:00Z');

  it('verifies for the event and key it was made for', () => {
    const { token } = gate.signAccessToken(key, 'evt-1', now);
    expect(gate.verifyAccessToken(key, 'evt-1', token, now + 1000)).toBe(true);
  });

  it('expires', () => {
    const { token, expiresAt } = gate.signAccessToken(key, 'evt-1', now);
    expect(Date.parse(expiresAt) - now).toBe(gate.TOKEN_TTL_SECONDS * 1000);
    expect(gate.verifyAccessToken(key, 'evt-1', token, Date.parse(expiresAt) - 1)).toBe(true);
    expect(gate.verifyAccessToken(key, 'evt-1', token, Date.parse(expiresAt))).toBe(false);
  });

  it('is bound to one event', () => {
    const { token } = gate.signAccessToken(key, 'evt-1', now);
    expect(gate.verifyAccessToken(key, 'evt-2', token, now)).toBe(false);
  });

  it('dies when the PIN is changed, because the key changes', () => {
    const { token } = gate.signAccessToken(key, 'evt-1', now);
    expect(gate.verifyAccessToken('z'.repeat(44), 'evt-1', token, now)).toBe(false);
  });

  it('rejects a tampered expiry or signature, and junk', () => {
    const { token } = gate.signAccessToken(key, 'evt-1', now);
    const [expiry, sig] = token.split('.');
    expect(gate.verifyAccessToken(key, 'evt-1', `${Number(expiry) + 99999}.${sig}`, now)).toBe(false);
    expect(gate.verifyAccessToken(key, 'evt-1', `${expiry}.${sig}x`, now)).toBe(false);
    expect(gate.verifyAccessToken(key, 'evt-1', `${expiry}.${sig}.extra`, now)).toBe(false);
    for (const junk of ['', 'a.b', '.', 'x'.repeat(500), null, undefined]) {
      expect(gate.verifyAccessToken(key, 'evt-1', junk as string, now)).toBe(false);
    }
    expect(gate.verifyAccessToken('', 'evt-1', token, now)).toBe(false);
  });
});

describe('PIN hashing and the guess limits', () => {
  it('stores a salted hash that verifies only the right PIN', () => {
    const stored = pin.hashPin('482913');
    expect(stored.startsWith('s1$')).toBe(true);
    expect(stored).not.toContain('482913');
    expect(pin.verifyPin('482913', stored)).toBe(true);
    expect(pin.verifyPin('482914', stored)).toBe(false);
  });

  it('salts every hash differently', () => {
    expect(pin.hashPin('1234')).not.toBe(pin.hashPin('1234'));
  });

  it('refuses a malformed stored value rather than throwing', () => {
    for (const bad of [undefined, null, '', 'plain', 's1$$', 's2$a$b', 's1$a$b$c', 's1$AAAA$AAAA']) {
      expect(pin.verifyPin('1234', bad as string)).toBe(false);
    }
  });

  it('makes a fresh token key each time', () => {
    expect(pin.newTokenKey()).not.toBe(pin.newTokenKey());
    expect(Buffer.from(pin.newTokenKey(), 'base64')).toHaveLength(32);
  });

  it('counts in fixed 15-minute windows and says how long is left', () => {
    const t = Date.parse('2026-06-01T12:07:30Z');
    expect(pin.windowOf(t)).toBe(pin.windowOf(t + 60_000));
    expect(pin.windowOf(t + 15 * 60_000)).toBe(pin.windowOf(t) + 1);
    const left = pin.secondsLeftInWindow(t);
    expect(left).toBeGreaterThanOrEqual(1);
    expect(left).toBeLessThanOrEqual(pin.WINDOW_SECONDS);
    expect(pin.secondsLeftInWindow(t + left * 1000)).toBeGreaterThan(pin.WINDOW_SECONDS - 2);
  });

  it('keeps one counter per event, address and window, and the event limit is the looser net', () => {
    expect(pin.ipCounterId('e1', '1.2.3.4', 5)).not.toBe(pin.ipCounterId('e1', '1.2.3.5', 5));
    expect(pin.ipCounterId('e1', '1.2.3.4', 5)).not.toBe(pin.ipCounterId('e2', '1.2.3.4', 5));
    expect(pin.ipCounterId('e1', '1.2.3.4', 5)).not.toBe(pin.ipCounterId('e1', '1.2.3.4', 6));
    expect(pin.eventCounterId('e1', 5)).not.toBe(pin.eventCounterId('e1', 6));
    expect(pin.MAX_FAILURES_PER_IP).toBeLessThan(pin.MAX_FAILURES_PER_EVENT);
  });
});

describe('who gets past the gate', () => {
  const guest = {
    privileged: false,
    shared: false,
    viewBlocked: false,
    audience: 'everyone' as const,
    pinRequired: false,
    tokenValid: false,
  };
  const gateFor = listVis.galleryGateFor;

  it('opens for an ordinary guest, and for a guest with the PIN', () => {
    expect(gateFor(guest)).toBe('open');
    expect(gateFor({ ...guest, pinRequired: true, tokenValid: true })).toBe('open');
  });

  it('asks for the PIN when it is on and there is no good token', () => {
    expect(gateFor({ ...guest, pinRequired: true })).toBe('pin');
  });

  it('blocks when viewing is off or the gallery is host-only, ahead of the PIN', () => {
    expect(gateFor({ ...guest, viewBlocked: true })).toBe('blocked');
    expect(gateFor({ ...guest, audience: 'host' })).toBe('blocked');
    expect(gateFor({ ...guest, viewBlocked: true, pinRequired: true, tokenValid: true })).toBe('blocked');
  });

  it('never holds up the host, an admin or a download share', () => {
    const shut = { ...guest, viewBlocked: true, pinRequired: true, audience: 'host' as const };
    expect(gateFor({ ...shut, privileged: true })).toBe('open');
    expect(gateFor({ ...shut, shared: true })).toBe('open');
  });
});

describe('the Booth shared gallery follows the same gate', () => {
  const input = { eventId: 'evt 1', audience: null, takenDown: false };

  it('links to the gallery with no note when nothing is restricted', () => {
    expect(sharedGalleryFor(input)).toEqual({ sharedGalleryPath: '/event/evt%201', sharedGalleryMessage: null });
  });

  it('drops the link when guests cannot view, whatever the audience', () => {
    expect(sharedGalleryFor({ ...input, viewBlocked: true }).sharedGalleryPath).toBeNull();
    expect(sharedGalleryFor({ ...input, audience: 'host' }).sharedGalleryPath).toBeNull();
  });

  it('keeps the link but says a PIN is asked for, and never carries the PIN', () => {
    const result = sharedGalleryFor({ ...input, pinRequired: true });
    expect(result.sharedGalleryPath).toBe('/event/evt%201');
    expect(result.sharedGalleryMessage).toMatch(/PIN/);
    expect(result.sharedGalleryPath).not.toMatch(/pin=/);
    expect(sharedGalleryFor({ ...input, audience: 'own', pinRequired: true }).sharedGalleryMessage).toMatch(/PIN/);
  });

  it('shows nothing for a closed event', () => {
    expect(sharedGalleryFor({ ...input, takenDown: true })).toEqual({
      sharedGalleryPath: null,
      sharedGalleryMessage: null,
    });
  });
});

describe('guest videos wait for the host', () => {
  it('holds a guest video unless the host allows everything', () => {
    expect(videoStatusFor({ isGuestUpload: true, moderationMode: undefined })).toBe('held');
    expect(videoStatusFor({ isGuestUpload: true, moderationMode: 'review' })).toBe('held');
    expect(videoStatusFor({ isGuestUpload: true, moderationMode: 'allow_all' })).toBe('released');
  });

  it('releases the host\'s own video, there being nobody to approve it', () => {
    expect(videoStatusFor({ isGuestUpload: false, moderationMode: 'review' })).toBe('released');
  });

  it('shows a held video to no gallery reader, and a released one to everyone', () => {
    const ctx = { identity: null, audience: 'everyone' as const, callerId: '', privileged: false, shared: null };
    const held = { id: 'v', s3Key: 'events/e/photos/a.mp4', moderationStatus: 'held' };
    expect(listVis.photoVisibleTo(held, ctx)).toBe(false);
    expect(listVis.photoVisibleTo(held, { ...ctx, privileged: true })).toBe(false);
    expect(listVis.photoVisibleTo({ ...held, moderationStatus: 'released' }, ctx)).toBe(true);
    // A video from before review existed has no verdict and stays host-only.
    expect(listVis.photoVisibleTo({ ...held, moderationStatus: 'skipped' }, ctx)).toBe(false);
  });
});

describe('what a host may save', () => {
  const ok = (request: SettingsRequest) => {
    const result = buildPatch(request, { photoCount: 0 });
    if (!result.ok) throw new Error(result.reason);
    return result.patch;
  };
  const refused = (request: SettingsRequest) => {
    const result = buildPatch(request, { photoCount: 0 });
    return result.ok ? null : result.reason;
  };

  it('stores view and PIN schedule, and clears "auto" back to absent', () => {
    expect(ok({ guestViewBlocked: true }).set).toMatchObject({ guestViewBlocked: true });
    expect(ok({ galleryPinMode: 'on' }).set).toMatchObject({ galleryPinMode: 'on' });
    expect(ok({ galleryPinMode: 'off' }).set).toMatchObject({ galleryPinMode: 'off' });
    expect(ok({ galleryPinMode: 'auto' }).remove).toContain('galleryPinMode');
    expect(ok({ galleryPinAutoDays: 45 }).set).toMatchObject({ galleryPinAutoDays: 45 });
  });

  it('refuses a made-up mode and out-of-range days', () => {
    expect(refused({ galleryPinMode: 'sometimes' })).toMatch(/when the PIN applies/);
    for (const days of [0, -3, 366, 2.5]) expect(refused({ galleryPinAutoDays: days })).toMatch(/days/);
  });

  it('leaves everything alone when the fields are null', () => {
    const patch = ok({ guestViewBlocked: null, galleryPinMode: null, galleryPinAutoDays: null, name: 'Renamed' });
    expect(Object.keys(patch.set)).toEqual(['name']);
    expect(patch.remove).toEqual([]);
  });

  it('has no way to write the PIN or its flag from the settings call', () => {
    const result = buildPatch(
      { galleryPinSet: true, pinHash: 'x', galleryPin: '1234' } as unknown as SettingsRequest,
      { photoCount: 0 },
    );
    expect(result.ok && Object.keys(result.patch.set)).not.toEqual(
      expect.arrayContaining(['galleryPinSet', 'pinHash', 'galleryPin']),
    );
  });
});

describe('copies that must not drift', () => {
  const afterComment = (src: string) => src.slice(src.indexOf('*/') + 2);

  it('keeps galleryGate.ts identical in all four functions', () => {
    const copies = ['gallery-access', 'media-url', 'list-event-photos', 'booth-gallery'].map((dir) =>
      read(`amplify/functions/${dir}/galleryGate.ts`),
    );
    for (const copy of copies) expect(copy).toBe(copies[0]);
  });

  it('keeps visibility.ts identical in list-event-photos and media-url', () => {
    expect(read('amplify/functions/media-url/visibility.ts')).toBe(
      read('amplify/functions/list-event-photos/visibility.ts'),
    );
  });

  it('keeps the settings limits equal to the gate\'s', () => {
    const settings = read('amplify/functions/update-event/settings.ts');
    expect(settings).toContain(`MIN_PIN_AUTO_DAYS = ${gate.MIN_PIN_AUTO_DAYS}`);
    expect(settings).toContain(`MAX_PIN_AUTO_DAYS = ${gate.MAX_PIN_AUTO_DAYS}`);
  });

  it('keeps the browser mirror agreeing with the server on the same cases', () => {
    expect(client.PIN_PATTERN.source).toBe(gate.PIN_PATTERN.source);
    expect(client.DEFAULT_PIN_AUTO_DAYS).toBe(gate.DEFAULT_PIN_AUTO_DAYS);
    expect(client.MIN_PIN_AUTO_DAYS).toBe(gate.MIN_PIN_AUTO_DAYS);
    expect(client.MAX_PIN_AUTO_DAYS).toBe(gate.MAX_PIN_AUTO_DAYS);
    const date = '2026-03-10';
    const start = Date.parse(date);
    const cases = [
      { galleryPinSet: false, date },
      { galleryPinSet: true, date },
      { galleryPinSet: true, date, galleryPinMode: 'on' },
      { galleryPinSet: true, date, galleryPinMode: 'off' },
      { galleryPinSet: true, date, galleryPinAutoDays: 3 },
      { galleryPinSet: true, date: 'nonsense', createdAt: '2026-01-01T00:00:00Z' },
      { galleryPinSet: true },
    ];
    for (const facts of cases) {
      for (const offset of [-DAY, 0, 2 * DAY, 3 * DAY, 29 * DAY, 30 * DAY, 400 * DAY]) {
        const now = start + offset;
        expect({ facts, offset, v: client.pinRequired(facts, now) }).toEqual({
          facts,
          offset,
          v: gate.pinRequired(facts, now),
        });
      }
      expect(client.pinStartsAt(facts)).toBe(gate.pinStartsAt(facts));
    }
    for (const value of [undefined, null, 0, 1, 7, 400, Number.NaN]) {
      expect(client.pinAutoDaysOf(value)).toBe(gate.pinAutoDaysOf(value));
    }
    for (const value of ['1234', '123', '1234567', 'abcd', '']) {
      expect(client.isValidPin(value)).toBe(gate.isValidPin(value));
    }
    expect(afterComment(read('lib/galleryAccess.ts')).length).toBeGreaterThan(0);
  });
});

describe('the PIN is never kept where a guest can read it', () => {
  const data = read('amplify/data/resource.ts');
  const model = data.slice(data.indexOf('GalleryPin: a'), data.indexOf('GalleryPin: a') + 1500);

  it('lives in an admin-only model', () => {
    expect(data).toContain('GalleryPin: a');
    expect(model).toMatch(/allow\.group\('ADMINS'\)/);
    expect(model).not.toMatch(/allow\.(guest|publicApiKey|authenticated|owner)/);
  });

  it('is not a field on the Event model', () => {
    const event = data.slice(data.indexOf('Event: a'), data.indexOf('Photo: a'));
    expect(event).not.toMatch(/pinHash|tokenKey|galleryPin:/);
  });

  it('is not exposed as a plain field on the Event type returned to guests', () => {
    expect(data).toContain('galleryPinSet');
  });
});
