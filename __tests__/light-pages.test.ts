import { readSource } from './sourceGuards';

/**
 * The pages a stranger or a guest lands on do not import `lib/api.ts`.
 *
 * ## What this is protecting
 *
 * `lib/api.ts` is one 3,200-line module. A bundler splits by module, not by
 * function, so importing a single symbol from it delivers all of it — and it
 * reaches `aws-amplify`'s auth, data and storage clients, the upload path, the
 * download path and the print checkout.
 *
 * The homepage imported one function from it: `trackEvent`. That one import
 * cost **30 KB gzipped** on a page whose job is to show marketing copy to
 * somebody who has never signed in. `/join` was the same, and worse in context
 * — a guest reaches it by typing a code off a printed sign, usually on venue
 * wifi, which is the connection this product exists to work on.
 *
 * So the handful of functions those pages need live in their own small modules
 * (`lib/trackEvent.ts`, `lib/findEvent.ts`), sharing `lib/dataClient.ts` with
 * `api.ts` without either importing the other.
 *
 * ## Why it needs a test rather than a comment
 *
 * The regression is one autocomplete away. `import { trackEvent } from
 * '@/lib/api'` still compiles, still typechecks, still passes every other test,
 * and still works perfectly — it is 30 KB heavier and nothing says so. A number
 * that only a manual `next build` would reveal is a number that goes unwatched.
 */

/** Pages reached without signing in, where the payload is the product. */
const LIGHT_PAGES = ['pages/index.tsx', 'pages/pricing.tsx', 'pages/join.tsx'];

describe.each(LIGHT_PAGES)('%s', (page) => {
  const source = readSource(page);

  it('does not import lib/api', () => {
    // Matches both `from '@/lib/api'` and a relative spelling of the same file,
    // but not `@/lib/apiSomething`.
    const heavy = /from\s+'(@\/lib\/api|\.\.?\/(?:\.\.\/)*lib\/api)'/.test(source);
    expect({ page, importsHeavyApi: heavy }).toEqual({ page, importsHeavyApi: false });
  });
});

describe('the light modules stay light', () => {
  it.each(['lib/trackEvent.ts', 'lib/findEvent.ts', 'lib/dataClient.ts'])(
    '%s does not reach back into lib/api',
    (module) => {
      // The split is a one-way edge. If any of these imported `api.ts`, every
      // light page would pull it right back in and the saving would vanish with
      // nothing failing.
      expect(readSource(module)).not.toContain("from '@/lib/api'");
    },
  );

  it('does not pull the storage client into the light path', () => {
    // Storage is the upload/download half of Amplify and none of these pages
    // show a photo. It is the single biggest thing the split removed.
    for (const module of ['lib/trackEvent.ts', 'lib/findEvent.ts', 'lib/dataClient.ts']) {
      expect(readSource(module)).not.toContain('aws-amplify/storage');
    }
  });
});

describe('lib/api.ts has no module-scope client', () => {
  it('builds its client lazily', () => {
    // A top-level `generateClient()` is a side effect a bundler cannot prove
    // away, which is what made every export in the file undroppable. It was
    // also constructed at import time — before `Amplify.configure` runs in
    // `_app` — so lazy is the more correct shape regardless of bundle size.
    const source = readSource('lib/api.ts');
    expect(source).not.toMatch(/^const client = generateClient/m);
  });
});
