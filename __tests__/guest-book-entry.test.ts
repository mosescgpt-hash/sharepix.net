import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  guestBookAvailable,
  screenEntryText,
  validateEntry,
} from '../amplify/functions/create-guest-book-entry/entry';
import { entryVisibleToGuests } from '../amplify/functions/list-guest-book-entries/visibility';

/**
 * The Lambda's copy of the guest book rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so the
 * rules exist twice. The copy is the one that is actually a control — a guest
 * is unauthenticated, so the browser's checks are a courtesy and this file is
 * the fence. These tests exercise it directly rather than trusting that it
 * still matches.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Everything after the file's opening doc comment, which differs by design. */
function bodyOf(source: string): string {
  const end = source.indexOf('*/');
  return source.slice(end + 2).trim();
}

describe('the two copies have not drifted', () => {
  it('is byte-identical to lib/guestBook.ts below the header', () => {
    // Hand-copied rules rot. If this fails, re-copy lib/guestBook.ts over
    // amplify/functions/create-guest-book-entry/entry.ts, keeping its header.
    const app = bodyOf(read('lib/guestBook.ts'));
    const lambda = bodyOf(read('amplify/functions/create-guest-book-entry/entry.ts'));
    expect(lambda).toBe(app);
  });

  it('keeps the list function agreeing about what guests see', () => {
    // A narrower copy, so compare behaviour rather than text.
    for (const entry of [
      { moderationStatus: 'ok' },
      { moderationStatus: 'flagged' },
      { moderationStatus: 'released' },
      { moderationStatus: 'ok', hidden: true },
      {},
    ]) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const app = require('../lib/guestBook').entryVisibleToGuests;
      expect(entryVisibleToGuests(entry)).toBe(app(entry));
    }
  });
});

describe('neither source file carries raw control characters', () => {
  // These files exist to strip control characters. Literal ones in the source
  // have broken this regex three times; assert the escapes survived.
  it.each([
    'lib/guestBook.ts',
    'amplify/functions/create-guest-book-entry/entry.ts',
  ])('%s is free of them', (path) => {
    const source = read(path);
    // eslint-disable-next-line no-control-regex
    expect(source).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/);
    // ...and still contains the escaped class it is supposed to.
    expect(source).toContain('\\u0000');
  });
});

describe('the fence the guest actually hits', () => {
  it('refuses an event with no guest book', () => {
    expect(guestBookAvailable({ tier: 'starter' })).toBe(false);
    expect(guestBookAvailable({ tier: 'standard', guestBookEnabled: null })).toBe(false);
  });

  it('allows one that has it', () => {
    expect(guestBookAvailable({ tier: 'premium' })).toBe(true);
    expect(guestBookAvailable({ tier: 'starter', guestBookEnabled: true })).toBe(true);
  });

  it('strips control characters out of a signature', () => {
    const result = validateEntry({ name: 'Ma\u0000ya\u007F', message: 'hi' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.name).toBe('Maya');
  });

  it('caps a message the client claimed was short', () => {
    // The browser enforces maxLength; the request does not have to.
    const result = validateEntry({ name: 'Maya', message: 'x'.repeat(100_000) });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entry.message.length).toBeLessThanOrEqual(1000);
  });

  it('refuses a submission that is entirely absent', () => {
    expect(validateEntry({}).ok).toBe(false);
  });

  it('holds a note carrying a link', () => {
    expect(screenEntryText('free stuff at www.spam.example', 'review').status).toBe('flagged');
  });
});
