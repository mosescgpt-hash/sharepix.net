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
    ).toEqual({ ok: true, name: 'Alex Rivera', email: 'alex@example.com' });
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
    // No update ever touches an attendee row: it is written once, conditionally.
    expect(handler).not.toMatch(/new UpdateItemCommand\(\{\s*TableName: ATTENDEE_TABLE/);
    expect(handler).toContain("if (known) return { ok: true, message: 'Welcome back.', token: known, name };");
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

  it('keeps booth mode an admin-only switch', () => {
    const settings = readSource('amplify/functions/update-event/settings.ts');
    expect(settings).not.toContain('boothMode');
  });
});

describe('the pages', () => {
  it('has a kiosk version that remembers nothing', () => {
    expect(boothSignupPath('e1', true)).toBe('/booth/e1?kiosk=1');
    const page = readSource('pages/booth/[eventId].tsx');
    expect(page).toContain('if (!kiosk) writeSaved(eventId, next);');
    expect(page).toContain('KIOSK_RESET_SECONDS');
  });

  it('shows the host card only on booth events', () => {
    const admin = readSource('pages/event/[eventId]/admin.tsx');
    expect(admin).toContain('event.boothMode === true && origin ?');
  });
});
