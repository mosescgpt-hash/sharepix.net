import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Lambda's copy of the backfill rule.
 *
 * `scripts/backfill-r2.ts` runs the `lib/` copy from an operator's machine; the
 * global-admin button runs this one in Lambda. They decide whether to copy a
 * guest's original photo into a second store, and one of them refusing where
 * the other copies would mean EXIF reaching R2 through whichever door happened
 * to be used.
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function bodyOf(source: string): string {
  const end = source.indexOf('*/');
  return source.slice(end + 2).trim();
}

describe('the two copies have not drifted', () => {
  it('is byte-identical to lib/r2Backfill.ts below the header', () => {
    expect(bodyOf(read('amplify/functions/backfill-r2/backfillDecision.ts'))).toBe(
      bodyOf(read('lib/r2Backfill.ts')),
    );
  });
});
