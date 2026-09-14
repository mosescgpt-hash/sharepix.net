import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { codeOnly, readSource } from './sourceGuards';

/**
 * The README says true things about the code.
 *
 * This exists because of what it replaced. The "Known gaps" section claimed,
 * for months:
 *
 *   - "Payments not wired up — event creation is free while testing"
 *   - "Photo limits not enforced server-side"
 *   - "any signed-in user can delete S3 objects under events/*"
 *
 * All three were false. Stripe checkout and the webhook had shipped, photo
 * limits were being reserved with a conditional DynamoDB update, and
 * `storage/resource.ts` had never granted delete to anybody. A newcomer reading
 * that section would have believed SharePix takes no money and has an open S3
 * bucket, and gone to fix two problems that did not exist while trusting a
 * security claim that was the exact opposite of the truth.
 *
 * Documentation rots in one direction: a gap gets closed and nobody edits the
 * paragraph that said it was open. So the claims that can be mechanically
 * checked are checked here, and a fix that leaves the README behind fails.
 *
 * It cannot check prose, and does not try. What it pins is the handful of
 * statements whose truth lives in a file this test can read.
 */

const README = readSource('README.md');
const root = join(__dirname, '..');

describe('the "what is not finished" list is still accurate', () => {
  it('is still gated on the flags it names', () => {
    // Each of these is only a real caveat while the feature is behind a flag.
    // If a flag stops existing, the bullet describing it has to go too.
    const backend = readSource('amplify/backend.ts');
    const waf = readSource('amplify/waf.ts');
    expect(backend).toContain('EMAIL_SENDING_ENABLED');
    expect(backend).toContain('STORAGE_RECLAIM_ENABLED');
    expect(codeOnly(waf)).toContain('WAF_ENABLED');
  });

  it('does not repeat the three claims that were false', () => {
    // Named exactly, because these specific sentences stood for months.
    expect(README).not.toContain('Payments not wired up');
    expect(README).not.toContain('Photo limits not enforced server-side');
    expect(README).not.toContain('any signed-in user can delete S3 objects');
  });

  it('says prints are on sandbox only while they are', () => {
    const claimed = README.includes('Prodigi sandbox and Stripe test mode');
    // The go-live doc is the thing that has to change first. If it is gone,
    // prints went live and the README bullet is stale.
    expect({ claimed, guideExists: existsSync(join(root, 'docs/go-live-prints.md')) }).toEqual({
      claimed,
      guideExists: claimed,
    });
  });
});

describe('the claims about authorization', () => {
  it('is right that storage grants no delete', () => {
    // The README tells a reader that deletion goes through a function. If a
    // delete grant is ever added to the bucket, that sentence becomes the most
    // dangerous kind of wrong — a security claim that reads as verified.
    const storage = codeOnly(readSource('amplify/storage/resource.ts'));
    expect(storage).not.toContain("'delete'");
    expect(storage).not.toContain('"delete"');
    expect(existsSync(join(root, 'amplify/functions/delete-event-photo'))).toBe(true);
  });

  it('is right that photo limits are reserved, not checked', () => {
    const handler = readSource('amplify/functions/create-event-photo/handler.ts');
    // A conditional update is what makes two concurrent uploads unable to take
    // the same last slot. A plain read-then-write would not.
    expect(handler).toContain('photoCount < :limit');
  });

  it('is right that payments are wired up', () => {
    for (const fn of ['stripe-checkout', 'stripe-webhook']) {
      expect(existsSync(join(root, 'amplify/functions', fn))).toBe(true);
    }
  });

  it('is right that no professional original is ever signed', () => {
    // The README makes a specific promise about a photographer's files.
    const rules = codeOnly(readSource('lib/professionalMedia.ts'));
    expect(rules).toContain('mayServeToGuest');
    expect(rules).toContain('canDownload');
  });

  it('is right about the size of the event-code list', () => {
    const words = readSource('amplify/functions/create-event/eventCodeWords.ts');
    const count = (words.match(/'[a-z]+'/g) ?? []).length;
    // The README writes it with a thousands separator, as prose should.
    expect(README).toContain(count.toLocaleString('en-US'));
  });
});

describe('the numbers in the README', () => {
  it('counts the Lambdas correctly', () => {
    const count = readdirSync(join(root, 'amplify/functions'), { withFileTypes: true }).filter(
      (entry) => entry.isDirectory(),
    ).length;
    expect(README).toContain(`${count} Lambdas`);
  });

  // No suite count. It was in here for about five minutes, and it would have
  // meant every new test file forcing a README edit to restate a number nobody
  // reads. A guard is only worth its friction when the fact it pins is one
  // somebody would act on.
});

describe('the documentation table', () => {
  const linked = [...README.matchAll(/\]\((docs\/[^)]+)\)/g)].map((m) => m[1]);

  it('links only to files that exist', () => {
    const missing = linked.filter((path) => !existsSync(join(root, path)));
    expect({ missing }).toEqual({ missing: [] });
  });

  it('links every doc in the folder', () => {
    // The failure this prevents is a doc written, committed, and never found
    // again because nothing points at it.
    const onDisk = readdirSync(join(root, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => `docs/${name}`);
    const unlinked = onDisk.filter((path) => !linked.includes(path));
    expect({ unlinked }).toEqual({ unlinked: [] });
  });
});

describe('the commands the README tells you to run', () => {
  it('all exist in package.json', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const scripts: Record<string, string> = require('../package.json').scripts;
    for (const name of ['test', 'typecheck:backend', 'validate:backend', 'build', 'prebuild', 'dev', 'admin:grant']) {
      expect({ script: name, defined: name in scripts }).toEqual({ script: name, defined: true });
    }
  });
});
