import { readdirSync, readFileSync, existsSync } from 'fs';

// Live, Amplify sent the resolver's field name at the top level of the event
// (no `info.fieldName`), so handlers that switched on info.fieldName alone sent
// every call down their default path (PR #183). Every handler must accept both.
describe('every function reads the request name both ways', () => {
  const dirs = readdirSync('amplify/functions').filter((d) => existsSync(`amplify/functions/${d}/handler.ts`));
  it.each(dirs)('%s', (dir) => {
    const src = readFileSync(`amplify/functions/${dir}/handler.ts`, 'utf8');
    const reads = src.match(/\.info\?\.fieldName[^\n]*/g) ?? [];
    for (const line of reads) {
      expect({ dir, line, ok: /fieldName \?\? .*\.fieldName/.test(line) }).toEqual({ dir, line, ok: true });
    }
  });
});
