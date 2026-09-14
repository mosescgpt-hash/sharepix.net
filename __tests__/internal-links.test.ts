import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every internal href points at a page that exists.
 *
 * Written after shipping two of these. The help articles told guests to enter
 * their event code on a homepage with no field, and a "Sign in" link on /pro
 * pointed at /host-access — a route that has never existed, named after the
 * label in the navbar rather than the file behind it.
 *
 * Both fail the same way: silently. Next renders the link, the click goes to a
 * 404, and nothing in the build or the test suite notices.
 */

const root = join(__dirname, '..');
const PAGES = join(root, 'pages');

/** Every route the pages directory actually serves. */
function routes(dir = PAGES, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...routes(full, `${prefix}/${entry.name}`));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const base = entry.name.replace(/\.tsx?$/, '');
    out.push(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
  }
  return out;
}

const ALL_ROUTES = routes();

/** Whether a path matches a route, allowing for [param] segments. */
function served(path: string): boolean {
  const wanted = path.split('/').filter(Boolean);
  return ALL_ROUTES.some((route) => {
    const parts = route.split('/').filter(Boolean);
    if (parts.length !== wanted.length) return false;
    return parts.every((part, i) => part.startsWith('[') || part === wanted[i]);
  });
}

/** Every source file that could carry a link. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FILES = [join(root, 'pages'), join(root, 'components'), join(root, 'lib')]
  .filter(existsSync)
  .flatMap(sources);

describe('internal links', () => {
  it('found the routes it is checking against', () => {
    // A bug here would make every assertion below vacuous.
    expect(ALL_ROUTES).toContain('/');
    expect(ALL_ROUTES).toContain('/pricing');
    expect(ALL_ROUTES.length).toBeGreaterThan(15);
  });

  it('resolves a dynamic route', () => {
    expect(served('/event/abc123/upload')).toBe(true);
    expect(served('/event/abc123/nonsense')).toBe(false);
  });

  it('points every href at a page that exists', () => {
    const broken: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      // Literal internal hrefs only. Template strings and object hrefs carry
      // runtime values this cannot resolve, and guessing at them would produce
      // false failures — which is how a guard gets deleted.
      for (const match of source.matchAll(/href="(\/[^"#?]*)"/g)) {
        const path = match[1];
        if (path.startsWith('//')) continue;
        // A file in public/ is served at that path without being a page.
        // Checked against the directory rather than guessed from the
        // extension: the first draft capped extensions at five characters and
        // called /manifest.webmanifest broken.
        if (existsSync(join(root, 'public', path.replace(/^\//, '')))) continue;
        if (!served(path)) broken.push(`${file.replace(root + '/', '')} → ${path}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
