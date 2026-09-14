/**
 * Writes public/robots.txt and public/sitemap.xml from lib/seo.ts.
 *
 * Both could be hand-maintained files, and both would then be wrong within a
 * month. The sitemap has to name every help article; the disallow list has to
 * name every private prefix. Neither is something anyone will remember to
 * update while adding a page, so they are generated from the one list that
 * adding a page already forces you to touch — `__tests__/seo.test.ts` fails
 * until a new route is classified.
 *
 * Generated rather than served from getServerSideProps because the content
 * changes only when this repository does. A static file costs nothing to serve,
 * cannot fail at request time, and is cached by CloudFront like any other
 * asset.
 *
 * Runs from `prebuild`, and the output is committed so a diff shows when the
 * public surface of the site changed. The bodies themselves are built in
 * lib/seo.ts, so a test can compare the committed files against them and catch
 * the usual failure of a generated file: source edited, generator not rerun.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapUrls, sitemapXml } from '../lib/seo';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

mkdirSync(PUBLIC_DIR, { recursive: true });
writeFileSync(join(PUBLIC_DIR, 'robots.txt'), robotsTxt(), 'utf8');
writeFileSync(join(PUBLIC_DIR, 'sitemap.xml'), sitemapXml(), 'utf8');

console.log(`seo: wrote robots.txt and sitemap.xml (${sitemapUrls().length} URLs)`);
