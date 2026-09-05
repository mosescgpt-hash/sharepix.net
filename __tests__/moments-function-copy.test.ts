import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_MOMENTS_PER_EVENT,
  validateMoment,
} from '../amplify/functions/save-moment/moment';

/**
 * The Lambda's copy of the moment rules.
 *
 * Amplify functions bundle separately and cannot import from `lib/`, so the
 * rules exist twice. The copy is the one that is actually a control: the
 * browser's checks are a courtesy to the host, and this file is the fence.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** Everything after the file's opening doc comment, which differs by design. */
function bodyOf(source: string): string {
  const end = source.indexOf('*/');
  return source.slice(end + 2).trim();
}

describe('the two copies have not drifted', () => {
  it('is byte-identical to lib/moments.ts below the header', () => {
    // Hand-copied rules rot. If this fails, re-copy lib/moments.ts over
    // amplify/functions/save-moment/moment.ts, keeping its header.
    expect(bodyOf(read('amplify/functions/save-moment/moment.ts'))).toBe(
      bodyOf(read('lib/moments.ts')),
    );
  });
});

describe('neither source file carries raw control characters', () => {
  // These files exist to strip control characters. Literal ones in the source
  // have broken this kind of code repeatedly in this repo; assert that the
  // scan-based implementation stayed free of them.
  it.each(['lib/moments.ts', 'amplify/functions/save-moment/moment.ts'])(
    '%s is free of them',
    (path) => {
      const source = read(path);
      for (let i = 0; i < source.length; i += 1) {
        const code = source.charCodeAt(i);
        const allowed = code === 9 || code === 10 || code === 13;
        expect({ path, index: i, code, allowed: allowed || code >= 32 }).toEqual({
          path,
          index: i,
          code,
          allowed: true,
        });
      }
    },
  );
});

describe('the server copy enforces the same rules', () => {
  it('rejects an unnamed moment', () => {
    expect(validateMoment({ name: '   ' }).ok).toBe(false);
  });

  it('accepts and cleans a named one', () => {
    const result = validateMoment({ name: '  The   Ceremony  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.moment.name).toBe('The Ceremony');
  });

  it('agrees with the app about the per-event ceiling', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = require('../lib/moments').MAX_MOMENTS_PER_EVENT;
    expect(MAX_MOMENTS_PER_EVENT).toBe(app);
  });
});
