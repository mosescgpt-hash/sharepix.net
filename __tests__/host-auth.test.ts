import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { codeOnly, readSource } from './sourceGuards';

/**
 * The sign-in screen a host meets, checked for the two things it got wrong.
 *
 * Nine pages wrapped themselves in a bare `withAuthenticator(Page)`, which
 * renders Amplify's default card on an empty white page — no wordmark, no
 * navigation, nothing saying what the person had been doing — and defaults to
 * **Sign In** on every one of them.
 *
 * Including `/create-event`, which is where somebody arrives from the homepage
 * having never heard of us. The last thing they saw was "Create an event
 * gallery"; the next was an unbranded box asking for a password they do not
 * have.
 */

const PAGES = join(__dirname, '..', 'pages');

function pageFiles(dir: string = PAGES): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return /\.tsx$/.test(entry) ? [relative(join(__dirname, '..'), full)] : [];
  });
}

describe('nothing uses the bare authenticator any more', () => {
  // Found by walking the tree rather than listing paths, so a page added next
  // year is covered without anybody remembering to add it here.
  const wrapped = pageFiles().filter((path) =>
    codeOnly(readSource(path)).includes('withAuthenticator('),
  );

  it('leaves no page on the unbranded default', () => {
    expect(wrapped).toEqual([]);
  });

  it('routes every gated page through the shared wrapper', () => {
    // The inverse check: something has to be wrapping them.
    const gated = pageFiles().filter((path) =>
      codeOnly(readSource(path)).includes('withHostAuth('),
    );
    expect(gated.length).toBeGreaterThanOrEqual(9);
    for (const path of gated) {
      expect(codeOnly(readSource(path))).toContain("from '@/components/hostAuth'");
    }
  });
});

describe('the two kinds of page open on the right tab', () => {
  const arrivingIn = (path: string) => {
    const source = codeOnly(readSource(path));
    return /arriving:\s*'(new|returning)'/.exec(source)?.[1] ?? null;
  };

  it('opens Create Account where a stranger lands', () => {
    // Getting this backwards is not symmetrical. A returning host shown Create
    // Account has one extra click; a prospect shown Sign In is being asked for
    // something they do not have.
    expect(arrivingIn('pages/create-event.tsx')).toBe('new');
    expect(arrivingIn('pages/corporate.tsx')).toBe('new');
  });

  it('opens Sign In where only an existing host can want to be', () => {
    for (const path of [
      'pages/my-events.tsx',
      'pages/account.tsx',
      'pages/account-security.tsx',
      'pages/global-admin.tsx',
      'pages/event/[eventId]/admin.tsx',
    ]) {
      expect(arrivingIn(path)).toBe('returning');
    }
  });
});

describe('the screen says where it is and what it is for', () => {
  const wrapper = readSource('components/hostAuth.tsx');

  it('carries the wordmark and a way back', () => {
    expect(wrapper).toContain('share<span className="text-pine">pix</span>');
    expect(wrapper).toContain('Back to sharepix.net');
  });

  it('answers the question somebody is asking at that exact moment', () => {
    // Whether their guests will have to do this too. The answer is one of the
    // few things SharePix can say that is both a real product property and the
    // thing being doubted.
    expect(wrapper).toContain('Your guests never make one');
  });

  it('names what the person was in the middle of', () => {
    // A purpose line per page, rather than one generic sentence: the point is
    // that the screen is continuous with whatever they clicked.
    expect(readSource('pages/create-event.tsx')).toContain('Set up your event gallery.');
    expect(readSource('pages/my-events.tsx')).toContain('Your events.');
  });
});
