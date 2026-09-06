import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMAIL_KINDS,
  categoryOf,
  mayReceive,
  needsUnsubscribeLink,
  preferenceKey,
  type EmailKind,
} from '../lib/emailPreferences';

const ALL_KINDS = Object.keys(EMAIL_KINDS) as EmailKind[];
const OPTED_OUT = { unsubscribedAt: '2026-09-01T00:00:00.000Z' };

describe('where the line between essential and optional sits', () => {
  it('treats a gallery about to be deleted as essential', () => {
    // The whole reason the line exists. A host who opted out of a newsletter in
    // March must not lose their wedding photos in December because of it.
    expect(categoryOf('gallery-expiry')).toBe('essential');
    expect(mayReceive('host@example.com', 'gallery-expiry', OPTED_OUT)).toBe(true);
  });

  it('treats a photo waiting for review as essential', () => {
    // It blocks their event from working.
    expect(categoryOf('moderation-alert')).toBe('essential');
    expect(mayReceive('host@example.com', 'moderation-alert', OPTED_OUT)).toBe(true);
  });

  it('treats everything we send because we want something as optional', () => {
    for (const kind of ['research-survey', 'growth-nudge', 'monthly-report'] as EmailKind[]) {
      expect(categoryOf(kind)).toBe('optional');
      expect(mayReceive('host@example.com', kind, OPTED_OUT)).toBe(false);
    }
  });

  it('sends optional mail to someone who has not opted out', () => {
    // The default for an address we have never seen is subscribed, which is
    // lawful for mail to a customer about the service they bought — and is
    // exactly why the boundary above has to be honest rather than convenient.
    expect(mayReceive('host@example.com', 'research-survey', null)).toBe(true);
    expect(mayReceive('host@example.com', 'research-survey', {})).toBe(true);
  });

  it('categorises every kind of email, so a new one is a deliberate choice', () => {
    for (const kind of ALL_KINDS) {
      expect(['essential', 'optional']).toContain(categoryOf(kind));
    }
    expect(ALL_KINDS.length).toBeGreaterThan(0);
  });
});

describe('the unsubscribe link', () => {
  it('goes on optional mail', () => {
    expect(needsUnsubscribeLink('research-survey')).toBe(true);
  });

  it('stays off essential mail', () => {
    // Offering to unsubscribe from "your photos are about to be deleted"
    // invites someone to turn off the one message they will wish they had read.
    expect(needsUnsubscribeLink('gallery-expiry')).toBe(false);
    expect(needsUnsubscribeLink('moderation-alert')).toBe(false);
  });
});

describe('the address key', () => {
  it('folds case and trims, so one person is one row', () => {
    expect(preferenceKey('  Host@Example.COM ')).toBe('host@example.com');
  });

  it('does not apply provider-specific tricks', () => {
    // Dot-stripping and plus-tag removal are Gmail conventions, not rules.
    // Applying them would let an opt-out from one address silently mute a
    // different one elsewhere — which looks exactly like ignoring an
    // unsubscribe.
    expect(preferenceKey('a.b@example.com')).toBe('a.b@example.com');
    expect(preferenceKey('a+tag@example.com')).toBe('a+tag@example.com');
  });

  it('refuses anything that cannot be an address', () => {
    for (const value of ['', '   ', 'not-an-email', 'a b@example.com', null, undefined]) {
      expect(preferenceKey(value)).toBe('');
    }
    expect(preferenceKey(`${'x'.repeat(250)}@example.com`)).toBe('');
  });

  it('refuses to send anywhere it cannot make a key', () => {
    // Sending to '' is a bounce and a reputation hit, not a no-op — so even
    // essential mail stops here.
    expect(mayReceive('', 'gallery-expiry', null)).toBe(false);
    expect(mayReceive(null, 'gallery-expiry', null)).toBe(false);
    expect(mayReceive('nonsense', 'gallery-expiry', null)).toBe(false);
  });
});

describe('the unsubscribe endpoint', () => {
  const handler = readFileSync(
    join(__dirname, '..', 'amplify', 'functions', 'unsubscribe-email', 'handler.ts'),
    'utf8',
  );

  it('checks a token rather than trusting the address alone', () => {
    // Without this, anyone could opt a competitor's customers out of their own
    // mail by guessing addresses, and the first sign would be a customer
    // wondering why they stopped hearing from us.
    expect(handler).toContain('tokensMatch(stored, token)');
  });

  it('compares the token in constant time', () => {
    expect(handler).toContain('timingSafeEqual');
  });

  it('gives the same answer for a wrong token and an unknown address', () => {
    // Anything else is an oracle for whether an address is a SharePix customer.
    expect(handler).toContain('const REFUSED =');
    const throws = handler.match(/throw new Error\(([^)]*)\)/g) ?? [];
    for (const line of throws) expect(line).toContain('REFUSED');
  });

  it('never echoes the address back to the caller', () => {
    // A reflected value is one more thing that can end up in a log or a
    // referrer. Checked against the variables that actually hold the address,
    // rather than the word "email", which legitimately appears in the message.
    const returned = handler.slice(handler.indexOf('return {'));
    expect(returned).not.toContain('event.arguments.email');
    expect(returned).not.toMatch(/\bkey\b/);
  });
});

describe('the unsubscribe page', () => {
  const page = readFileSync(join(__dirname, '..', 'pages', 'unsubscribe.tsx'), 'utf8');

  it('needs a click, so a mail scanner cannot unsubscribe anyone', () => {
    // Clients and security scanners follow links before a human sees them. A
    // GET that opted out on arrival would silently unsubscribe people who
    // never chose to leave, and they would never learn why the mail stopped.
    expect(page).toContain('onClick={() => void handleUnsubscribe()}');
    expect(page).not.toMatch(/useEffect\([^)]*handleUnsubscribe/);
  });

  it('says plainly what keeps arriving', () => {
    expect(page).toMatch(/before a gallery closes/i);
  });
});
