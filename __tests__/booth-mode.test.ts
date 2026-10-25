import {
  MAX_ATTENDEES_PER_EVENT,
  boothOpen,
  validateSignup,
} from '../amplify/functions/booth-signup/signup';
import { BOOTH_CONSENT_TEXT, boothQrPayload, boothSignupPath, tokenFromBoothQr } from '../lib/booth';
import { codeOnly, readSource } from './sourceGuards';

describe('booth sign-up rules', () => {
  it('stores a tidy name and a lower-cased email, with consent', () => {
    expect(
      validateSignup({ name: '  Alex \n Rivera ', email: ' Alex@Example.COM ', consent: true }),
    ).toEqual({ ok: true, name: 'Alex Rivera', email: 'alex@example.com', phone: null, smsConsent: false });
  });

  it('refuses a sign-up without consent, a name or a real email', () => {
    expect(validateSignup({ name: 'Alex', email: 'a@b.co', consent: false }).ok).toBe(false);
    expect(validateSignup({ name: ' ', email: 'a@b.co', consent: true }).ok).toBe(false);
    expect(validateSignup({ name: 'Alex', email: 'not-an-email', consent: true }).ok).toBe(false);
    expect(validateSignup({ name: 'x'.repeat(81), email: 'a@b.co', consent: true }).ok).toBe(false);
  });

  it('opens only on a live event an admin switched to booth mode', () => {
    expect(boothOpen({ boothMode: true })).toBe(true);
    expect(boothOpen({ boothMode: null })).toBe(false);
    expect(boothOpen({ boothMode: true, paid: false })).toBe(false);
    expect(boothOpen({ boothMode: true, takenDownAt: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(boothOpen({ boothMode: true, hostDeletedAt: '2026-10-01T00:00:00Z' })).toBe(false);
  });

  it('keeps an abuse ceiling per event', () => {
    // Sized for a trade-show floor like CES.
    expect(MAX_ATTENDEES_PER_EVENT).toBe(10000);
    const handler = codeOnly(readSource('amplify/functions/booth-signup/handler.ts'));
    expect(handler).toContain('boothAttendeeCount < :max');
  });

  it('never lets a repeat sign-up overwrite someone else\'s row', () => {
    const handler = codeOnly(readSource('amplify/functions/booth-signup/handler.ts'));
    // The only update to an existing attendee row adds a missing gallery key;
    // it can never rename anyone or replace a key.
    const updates = [...handler.matchAll(/new UpdateItemCommand\(\{\s*TableName: ATTENDEE_TABLE[\s\S]*?\}\)/g)].map((m) => m[0]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("'SET galleryKey = if_not_exists(galleryKey, :key), contactLabel = if_not_exists(contactLabel, :label)'");
    expect(handler).toContain("return { ok: true, message: 'Welcome back.', token: known, name };");
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(id)'");
  });
});

describe('the QR code', () => {
  it('carries a token, never an email, and reads back', () => {
    const token = 'abcDEF123_-xyz789AB';
    expect(boothQrPayload(token)).not.toContain('@');
    expect(tokenFromBoothQr(boothQrPayload(token))).toBe(token);
    expect(tokenFromBoothQr('https://example.com')).toBeNull();
    expect(tokenFromBoothQr('sharepix-booth:short')).toBeNull();
  });

  it('discloses that the host can see the photos', () => {
    expect(BOOTH_CONSENT_TEXT).toMatch(/host can also see/);
  });
});

describe('who can reach attendee rows', () => {
  const schema = readSource('amplify/data/resource.ts');
  const model = schema.slice(schema.indexOf('BoothAttendee: a'), schema.indexOf('GuestBookEntry: a'));

  it('lets the host read and delete their own, with no guest access and no direct create', () => {
    expect(model).toContain("allow.ownerDefinedIn('eventOwner').to(['get', 'list', 'delete'])");
    expect(model).not.toContain('allow.guest()');
    expect(model).not.toContain('allow.authenticated()');
  });

  it('lets the host switch booth mode, but never set the sign-up count', () => {
    const { EDITABLE_FIELDS } = require('../amplify/functions/update-event/settings') as {
      EDITABLE_FIELDS: readonly string[];
    };
    expect(EDITABLE_FIELDS).toContain('boothMode');
    expect(EDITABLE_FIELDS).not.toContain('boothAttendeeCount');
  });
});

describe('the pages', () => {
  it('has a kiosk version that remembers nothing', () => {
    expect(boothSignupPath('e1', true)).toBe('/booth/e1?kiosk=1');
    const page = readSource('pages/booth/[eventId].tsx');
    expect(page).toContain('if (!kiosk) writeSaved(eventId, next);');
    expect(page).toContain('KIOSK_RESET_SECONDS');
  });

  it('offers booth mode on every event, with the attendee list once it is on', () => {
    const admin = readSource('pages/event/[eventId]/admin.tsx');
    expect(admin).toContain('on={event.boothMode === true}');
    expect(admin).toContain('<BoothTab');
    const card = readSource('components/BoothModeCard.tsx');
    expect(card).toContain('Open the Booth tab');
    expect(card).toContain('Turn on booth mode');
  });
});
