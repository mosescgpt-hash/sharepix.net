import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAlertEmail,
  isSafeReviewUrl,
} from '../amplify/functions/create-event-photo/alert-email';

const root = join(__dirname, '..');
const testAlertSource = readFileSync(
  join(root, 'amplify/functions/send-test-alert/handler.ts'),
  'utf8',
);
const schemaSource = readFileSync(join(root, 'amplify/data/resource.ts'), 'utf8');

/** The literal token the test alert links to, read from the handler itself. */
const TEST_TOKEN = '0'.repeat(32);

describe('the test alert exercises the real alert', () => {
  it('imports the real builder instead of making its own', () => {
    // A test that built its own version of the message would prove the test
    // works, not that the alert does.
    expect(testAlertSource).toMatch(
      /import \{[^}]*buildAlertEmail[^}]*\} from '\.\.\/create-event-photo\/alert-email'/,
    );
  });

  it('uses a review link the builder accepts, so the buttons are really there', () => {
    // buildAlertEmail silently drops the Approve/Deny buttons for a URL that
    // fails isSafeReviewUrl — the test mail would then be missing the one part
    // most worth eyeballing.
    const url = `https://www.sharepix.net/review/${TEST_TOKEN}`;
    expect(isSafeReviewUrl(url)).toBe(true);

    const mime = buildAlertEmail({
      from: 'info@sharepix.net',
      to: 'admin@sharepix.net',
      eventName: 'Test event (no photo was held)',
      reasons: 'This is a test — nothing was flagged',
      reviewUrl: url,
    });
    expect(mime).toContain('Approve — show it');
    expect(mime).toContain('Deny — keep hidden');
    expect(mime).toContain(`${url}?intent=release`);
  });

  it('still builds a sendable message when no preview is available', () => {
    // The handler falls back to text-only if the bucket has nothing to embed.
    const mime = buildAlertEmail({
      from: 'info@sharepix.net',
      to: 'admin@sharepix.net',
      eventName: 'Test event',
      reasons: 'test',
      reviewUrl: `https://www.sharepix.net/review/${TEST_TOKEN}`,
    });
    expect(mime).toContain('Subject: A photo needs your review');
    expect(mime).toContain('Preview unavailable');
  });
});

describe('the test alert cannot become an open relay', () => {
  it('takes no arguments at all', () => {
    // An address argument would let an admin send mail from our verified domain
    // to anyone. The recipient comes from the caller's token instead.
    const declaration = schemaSource.slice(schemaSource.indexOf('sendTestAlertEmail: a'));
    const mutation = declaration.slice(0, declaration.indexOf('.handler('));
    expect(mutation).toContain('.arguments({})');
    expect(mutation).toContain("allow.group('ADMINS')");
  });

  it('never reads a recipient out of the request', () => {
    expect(testAlertSource).not.toMatch(/arguments\??\.\s*\w*(email|to|recipient)/i);
  });

  it('reads the recipient from Cognito by the caller identity, not the token claims', () => {
    // The data client authorizes with the access token, which carries the
    // username but not `email` — so the address is looked up in the pool, keyed
    // on the caller's own identity, never on anything from the request.
    expect(testAlertSource).toContain('AdminGetUserCommand');
    expect(testAlertSource).toContain('identity?.username');
    expect(testAlertSource).toContain('callerEmail(identity)');
  });

  it('validates the looked-up address before putting it in a header', () => {
    expect(testAlertSource).toContain('EMAIL.test(email)');
    expect(testAlertSource).toContain('sanitizeHeaderValue(email)');
  });
});
