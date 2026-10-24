import { webcrypto } from 'node:crypto';
import { readFileSync } from 'fs';
import qrcode from 'qrcode-generator';
import {
  checkContact,
  contactLabel,
  maskEmail,
  maskPhone,
  newPersonId,
  normalizePhone,
  openContact,
  parseOfflinePayload,
  sealContact,
} from '../lib/boothSeal';
import {
  findDividerCode,
  isLargeInFrame,
} from '../amplify/functions/process-pro-photo/boothDivider';
import {
  belongsToDivider,
  cameraAtISO,
  cameraScanKey,
  offlineAttendeeId,
} from '../amplify/functions/process-pro-photo/boothOffline';
import { boothSmsConsentText, parseKioskState } from '../lib/booth';
import { validateSignup, maskedContact } from '../amplify/functions/booth-signup/signup';
import { channelsFor, deliveryDue, reminderDue } from '../amplify/functions/booth-deliveries/plan';
import { buildBoothSms } from '../amplify/functions/booth-deliveries/sms';
import { applyAssignment, isAssignAction, matchAfter } from '../amplify/functions/booth-scan/recipients';
import { boothGroups } from '../lib/boothGroups';
import { createHash } from 'node:crypto';

async function keyPair() {
  const subtle = webcrypto.subtle;
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicKey: Buffer.from(await subtle.exportKey('raw', pair.publicKey)).toString('base64url'),
    privateKey: Buffer.from(await subtle.exportKey('pkcs8', pair.privateKey)).toString('base64url'),
  };
}

const EVENT = 'evt-123';

describe('sealed offline booth codes', () => {
  it('round-trips, and only for the event it was made for', async () => {
    const keys = await keyPair();
    const personId = newPersonId();
    const contact = { email: 'jane@gmail.com', phone: '+15551234567', smsConsent: true };
    const payload = await sealContact({ contact, eventId: EVENT, personId, publicKey: keys.publicKey });
    expect(payload.startsWith(`SPB1.${personId}.`)).toBe(true);
    expect(payload).not.toContain('jane');
    const opened = await openContact({ payload, eventId: EVENT, privateKeyPkcs8: keys.privateKey });
    expect(opened).toEqual({ personId, contact });
    expect(await openContact({ payload, eventId: 'other', privateKeyPkcs8: keys.privateKey })).toBeNull();
    // A swapped person id breaks the authenticated data.
    const swapped = payload.replace(personId, newPersonId());
    expect(await openContact({ payload: swapped, eventId: EVENT, privateKeyPkcs8: keys.privateKey })).toBeNull();
    // Someone else's key opens nothing.
    const other = await keyPair();
    expect(await openContact({ payload, eventId: EVENT, privateKeyPkcs8: other.privateKey })).toBeNull();
  });

  it('accepts a standard-base64 private key too (as pasted into a console)', async () => {
    const keys = await keyPair();
    const std = Buffer.from(keys.privateKey, 'base64url').toString('base64');
    const payload = await sealContact({
      contact: { email: null, phone: '+15551234567', smsConsent: true },
      eventId: EVENT,
      personId: newPersonId(),
      publicKey: keys.publicKey,
    });
    expect((await openContact({ payload, eventId: EVENT, privateKeyPkcs8: std }))?.contact.phone).toBe('+15551234567');
  });

  it('stays small enough to scan easily, even with a very long email', async () => {
    const keys = await keyPair();
    const seal = (email: string) =>
      sealContact({
        contact: { email, phone: '+15551234567', smsConsent: true },
        eventId: EVENT,
        personId: newPersonId(),
        publicKey: keys.publicKey,
      });
    const typical = await seal('jane.doe@gmail.com');
    expect(typical.length).toBeLessThanOrEqual(220);
    const longest = await seal(`${'a'.repeat(64)}@${'b'.repeat(180)}.com`);
    expect(longest.length).toBeLessThanOrEqual(520);
    // Fits a QR at error-correction M (byte mode, version ≤ 20).
    const qr = qrcode(0, 'M');
    qr.addData(longest);
    qr.make();
    expect(qr.getModuleCount()).toBeLessThanOrEqual(97);
  });

  it('rejects things that are not offline codes', () => {
    expect(parseOfflinePayload('sharepix-booth:abcdefabcdefabcdef')).toBeNull();
    expect(parseOfflinePayload('SPB1.short.AAAA')).toBeNull();
    expect(parseOfflinePayload('https://example.com')).toBeNull();
  });
});

describe('contact rules and masking', () => {
  it('needs an email or a phone, each with its own consent', () => {
    expect(checkContact({}).ok).toBe(false);
    expect(checkContact({ email: 'a@b.co' }).ok).toBe(false);
    expect(checkContact({ email: 'a@b.co', emailConsent: true }).ok).toBe(true);
    expect(checkContact({ phone: '555 123 4567' }).ok).toBe(false);
    const phoneOnly = checkContact({ phone: '(555) 123-4567', smsConsent: true });
    expect(phoneOnly).toEqual({ ok: true, contact: { email: null, phone: '+15551234567', smsConsent: true } });
  });

  it('normalizes phones to E.164', () => {
    expect(normalizePhone('555-123-4567')).toBe('+15551234567');
    expect(normalizePhone('1 555 123 4567')).toBe('+15551234567');
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(() => normalizePhone('12345')).toThrow();
    expect(normalizePhone('')).toBeNull();
  });

  it('masks what the host sees', () => {
    expect(maskEmail('jane@gmail.com')).toBe('j***@gmail.com');
    expect(maskPhone('+15551234567')).toBe('***-***-4567');
    expect(contactLabel({ email: null, phone: '+15551234567', smsConsent: true })).toBe('***-***-4567');
    expect(maskedContact('jane@gmail.com', null)).toBe('j***@gmail.com');
    expect(maskedContact(null, '+15551234567')).toBe('***-***-4567');
  });

  it('uses the exact texting consent wording', () => {
    expect(boothSmsConsentText('Smith Wedding')).toBe(
      'Text me a link to my photos from Smith Wedding. Msg & data rates may apply. Reply STOP to opt out.',
    );
  });

  it('online sign-up takes email and/or a cell number', () => {
    expect(validateSignup({ name: 'Jo', email: 'jo@x.co', consent: true }).ok).toBe(true);
    expect(validateSignup({ name: 'Jo', phone: '5551234567', smsConsent: true })).toMatchObject({
      ok: true,
      email: null,
      phone: '+15551234567',
    });
    expect(validateSignup({ name: 'Jo', phone: '5551234567' }).ok).toBe(false);
    expect(validateSignup({ name: 'Jo' }).ok).toBe(false);
  });

  it('offline and online sign-ups with the same email are one attendee', () => {
    const id = offlineAttendeeId(EVENT, { email: 'jo@x.co', phone: null, smsConsent: false });
    expect(id).toBe(`${EVENT}#${createHash('sha256').update('jo@x.co').digest('hex').slice(0, 32)}`);
  });
});

describe('the kiosk keeps no contact details', () => {
  it('stored state is only a name, a count and person ids', () => {
    const parsed = parseKioskState(
      JSON.stringify({ eventName: 'Gala', count: 2, personIds: ['abcdefghijkl', 'jane@gmail.com'], email: 'x@y.z' }),
    );
    expect(parsed).toEqual({ eventName: 'Gala', count: 2, personIds: ['abcdefghijkl'] });
    expect(Object.keys(parsed!)).toEqual(['eventName', 'count', 'personIds']);
  });

  it('the kiosk page never writes typed values to storage', () => {
    const src = readFileSync('pages/booth/kiosk/[eventId].tsx', 'utf8');
    expect(src).not.toMatch(/indexedDB\.|openDatabase|caches\.open/);
    const writes = src.match(/setItem\(.*\);/g) ?? [];
    expect(writes).toEqual(['setItem(kioskStorageKey(eventId), JSON.stringify(state));']);
  });

  it('the private key is never in client code', () => {
    for (const f of ['pages/booth/kiosk/[eventId].tsx', 'lib/boothSeal.ts', 'lib/booth.ts']) {
      expect(readFileSync(f, 'utf8')).not.toContain('BOOTH_PRIVATE_KEY');
    }
  });

  it('the processor has a byte-identical copy of the seal module', () => {
    expect(readFileSync('amplify/functions/process-pro-photo/boothSeal.ts', 'utf8')).toBe(
      readFileSync('lib/boothSeal.ts', 'utf8'),
    );
  });

  it('the service worker keeps the kiosk page and build assets', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toContain('/booth\\/kiosk\\/');
    expect(sw).toContain("'/_next/static/'");
  });
});

function qrBitmap(text: string, cell: number, canvas: number) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount() + 8; // quiet zone
  const size = n * cell;
  const data = new Uint8ClampedArray(canvas * canvas * 4).fill(255);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / cell) - 4;
      const my = Math.floor(y / cell) - 4;
      const dark = mx >= 0 && my >= 0 && mx < n - 8 && my < n - 8 && qr.isDark(my, mx);
      if (dark) {
        const i = (y * canvas + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return data;
}

describe('QR dividers in photos', () => {
  const payload = `SPB1.abcdefghijkl.${'A'.repeat(180)}`;

  it('counts a code that fills the frame', () => {
    expect(findDividerCode(qrBitmap(payload, 8, 800), 800, 800)).toBe(payload);
  });

  it('ignores a small code in the background', () => {
    // ~90 px code in a 1000 px frame.
    expect(isLargeInFrame([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }], 1000, 1000)).toBe(false);
    expect(
      isLargeInFrame([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }], 1000, 750),
    ).toBe(true);
  });

  it('ignores codes that are not offline booth codes', () => {
    expect(findDividerCode(qrBitmap('https://example.com/menu', 10, 600), 600, 600)).toBeNull();
  });
});

describe('camera-order splitting', () => {
  it('orders by the raw camera clock, with no age limit', () => {
    expect(cameraAtISO('2020:01:02 03:04:05')).toBe('2020-01-02T03:04:05.000Z');
    expect(cameraAtISO(null)).toBeNull();
    expect(cameraScanKey('e', 'p')).toBe('e#p#camera');
  });

  it('a photo in the same second as a divider goes to the new person', () => {
    const d1 = '2026-10-23T10:00:00.000Z';
    const d2 = '2026-10-23T10:05:00.000Z';
    expect(belongsToDivider(d1, d1, d2)).toBe(true);
    expect(belongsToDivider('2026-10-23T10:04:59.000Z', d1, d2)).toBe(true);
    expect(belongsToDivider(d2, d1, d2)).toBe(false);
    expect(belongsToDivider('2026-10-23T09:59:59.000Z', d1, null)).toBe(false);
  });

  it('manual divider clears recipients and is grouped apart', () => {
    expect(isAssignAction('divider')).toBe(true);
    expect(applyAssignment([{ id: 'a', name: 'A' }], 'divider', null)).toEqual([]);
    expect(matchAfter('divider', 0)).toBe('divider');
    const groups = boothGroups(
      ['p1', 'p2'],
      new Map([
        ['p1', { attendeeIds: [], attendeeNames: [], match: 'divider' }],
        ['p2', { attendeeIds: [], attendeeNames: [], match: 'unassigned' }],
      ]),
      [],
    );
    expect(groups.map((g) => g.key)).toEqual(['none', 'dividers']);
  });
});

describe('texting delivery', () => {
  const base = { email: null, emailsStopped: false, deliveredCount: 0, reminderSentAt: null };
  const texter = { ...base, phone: '+15551234567', smsConsent: true };

  it('is off unless switched on, and needs consent', () => {
    expect(deliveryDue(texter, 3)).toBeNull();
    expect(deliveryDue(texter, 3, true)).toBe('ready');
    expect(deliveryDue({ ...texter, smsConsent: false }, 3, true)).toBeNull();
    expect(deliveryDue({ ...texter, smsStopped: true }, 3, true)).toBeNull();
    // Nothing approved yet: nothing sent.
    expect(deliveryDue(texter, 0, true)).toBeNull();
  });

  it('texts the first message and the reminder, not every extra batch', () => {
    expect(channelsFor(texter, 'ready', true)).toEqual({ email: false, sms: true });
    expect(channelsFor(texter, 'more', true)).toEqual({ email: false, sms: false });
    expect(deliveryDue({ ...texter, deliveredCount: 2 }, 5, true)).toBeNull();
    expect(
      reminderDue({ ...texter, deliveredCount: 2 }, '2026-01-10', '2026-01-09', '2026-01-20', true),
    ).toBe(true);
  });

  it('the text has the link and how to stop', () => {
    const sms = buildBoothSms({ kind: 'ready', eventName: 'Gala', galleryUrl: 'https://www.sharepix.net/booth/photos/k' });
    expect(sms).toBe('SharePix: your photos from Gala are ready. https://www.sharepix.net/booth/photos/k Reply STOP to opt out.');
  });
});
