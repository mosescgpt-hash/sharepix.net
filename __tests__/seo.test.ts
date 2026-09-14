import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_DESCRIPTION,
  DISALLOWED_PREFIXES,
  INDEXABLE_ROUTES,
  OG_IMAGE_PATH,
  PRIVATE_ROUTES,
  ROUTE_DESCRIPTIONS,
  SITE_ORIGIN,
  canonicalUrl,
  describeRoute,
  isIndexable,
  organizationJsonLd,
  pricingJsonLd,
  robotsTxt,
  sitemapUrls,
  sitemapXml,
  webSiteJsonLd,
} from '../lib/seo';
import { HELP_ARTICLES } from '../lib/help';
import { CORPORATE_PLAN, PRICING_TIERS } from '../lib/pricing';

/**
 * The half of SEO that can actually be tested.
 *
 * Nothing here says whether the copy ranks. What it says is that the mechanism
 * cannot silently stop working: that a page added next month is classified
 * rather than quietly indexed, that the sitemap and robots.txt agree with the
 * allowlist they were generated from, and that no private route leaks into
 * either.
 *
 * The last one is the reason this file exists. The routes under `/event/` hold
 * guests' photographs, and the failure mode of getting this wrong is not a bad
 * search result.
 */

const root = join(__dirname, '..');
const PAGES = join(root, 'pages');

/**
 * Every route `pages/` serves, as Next.js names it.
 *
 * A near-copy of the walker in internal-links.test.ts. Duplicated rather than
 * shared because the alternative is importing from a test file, which would run
 * that file's assertions a second time inside this one.
 */
function routes(dir = PAGES, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `_app`, `_document`, and anything hidden are not routes.
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

describe('every page is classified', () => {
  it('finds the routes at all', () => {
    // If the walker breaks, every other test here passes vacuously.
    expect(ALL_ROUTES).toContain('/');
    expect(ALL_ROUTES).toContain('/pricing');
    expect(ALL_ROUTES).toContain('/event/[eventId]/admin');
    expect(ALL_ROUTES.length).toBeGreaterThan(25);
  });

  it('puts each route on exactly one of the two lists', () => {
    const indexable = new Set<string>(INDEXABLE_ROUTES);
    const priv = new Set<string>(PRIVATE_ROUTES);

    const unclassified = ALL_ROUTES.filter((r) => !indexable.has(r) && !priv.has(r));
    // The message is the point: whoever added the page has to decide, and the
    // failure tells them where to write the decision down.
    expect({ unclassified }).toEqual({ unclassified: [] });

    const both = ALL_ROUTES.filter((r) => indexable.has(r) && priv.has(r));
    expect(both).toEqual([]);
  });

  it('lists no route that does not exist', () => {
    const real = new Set(ALL_ROUTES);
    expect([...INDEXABLE_ROUTES].filter((r) => !real.has(r))).toEqual([]);
    expect([...PRIVATE_ROUTES].filter((r) => !real.has(r))).toEqual([]);
  });
});

describe('nothing private is indexable', () => {
  it('keeps every event route out', () => {
    for (const route of ALL_ROUTES.filter((r) => r.startsWith('/event/'))) {
      expect(isIndexable(route)).toBe(false);
    }
  });

  it('keeps every token-bearing route out', () => {
    // Each of these has a single-use secret in the path. Indexing one publishes
    // the secret.
    for (const route of ['/review/[token]', '/rating/[link]', '/survey/[link]', '/share/[shareId]']) {
      expect(isIndexable(route)).toBe(false);
    }
  });

  it('treats an unknown route as private', () => {
    // The default-deny rule, asserted directly: this is what protects a page
    // somebody adds without reading lib/seo.ts.
    expect(isIndexable('/something-added-next-month')).toBe(false);
  });

  it('does not disallow /pro, which is the photographer landing page', () => {
    // `/pro/join` and `/pro/events/` are disallowed; a bare `/pro` prefix would
    // take the marketing page down with them.
    expect(DISALLOWED_PREFIXES).not.toContain('/pro');
    expect(DISALLOWED_PREFIXES).not.toContain('/pro/');
    expect(isIndexable('/pro')).toBe(true);
  });

  it('indexes no page that is behind the sign-in wall', () => {
    // This caught /corporate, which reads like a marketing page and is wrapped
    // in withAuthenticator — so what a crawler fetches is an Amplify sign-in
    // form with no content and no title. Submitting that in a sitemap is worse
    // than not submitting it: it is a page that will never match what it
    // claims to be about.
    const gated = INDEXABLE_ROUTES.filter((route) => {
      const base = join(PAGES, route === '/' ? 'index' : route.slice(1));
      const file = ['.tsx', '.ts'].map((ext) => `${base}${ext}`).find((p) => existsSync(p))
        ?? ['index.tsx', 'index.ts'].map((f) => join(base, f)).find((p) => existsSync(p));
      return file ? readFileSync(file, 'utf8').includes('withAuthenticator') : false;
    });
    expect({ gated }).toEqual({ gated: [] });
  });

  it('covers every private route with a disallow prefix', () => {
    const uncovered = PRIVATE_ROUTES.filter(
      (route) => !DISALLOWED_PREFIXES.some((prefix) => route.startsWith(prefix)),
    );
    expect({ uncovered }).toEqual({ uncovered: [] });
  });

  it('disallows no prefix that would swallow an indexable route', () => {
    const swallowed = INDEXABLE_ROUTES.filter((route) =>
      DISALLOWED_PREFIXES.some((prefix) => route.startsWith(prefix)),
    );
    expect({ swallowed }).toEqual({ swallowed: [] });
  });
});

describe('descriptions', () => {
  it('gives every indexable route its own', () => {
    const missing = INDEXABLE_ROUTES.filter(
      (route) => route !== '/help/[slug]' && !ROUTE_DESCRIPTIONS[route],
    );
    expect({ missing }).toEqual({ missing: [] });
  });

  it('does not reuse the same sentence across pages', () => {
    // The state this work replaced: one description on thirty pages.
    const values = Object.values(ROUTE_DESCRIPTIONS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps them inside what a search result will show', () => {
    for (const [route, text] of Object.entries(ROUTE_DESCRIPTIONS)) {
      // Past roughly 160 characters the tail is replaced with an ellipsis,
      // which is usually where the sentence loses its verb. The route is in the
      // assertion so a failure names the page rather than just a number.
      expect({ route, tooShort: text.length < 60 }).toEqual({ route, tooShort: false });
      expect({ route, tooLong: text.length > 175 }).toEqual({ route, tooLong: false });
    }
  });

  it('quotes the paid price from the tier list rather than a literal', () => {
    const paid = PRICING_TIERS.find((tier) => tier.price > 0);
    expect(paid).toBeDefined();
    expect(ROUTE_DESCRIPTIONS['/pricing']).toContain(`$${paid!.price}`);
  });

  it('uses a help article summary for that article', () => {
    const article = HELP_ARTICLES[0];
    expect(describeRoute('/help/[slug]', { slug: article.slug })).toBe(article.summary);
  });

  it('falls back to the help index for an unknown slug', () => {
    expect(describeRoute('/help/[slug]', { slug: 'no-such-article' })).toBe(
      ROUTE_DESCRIPTIONS['/help'],
    );
  });

  it('falls back to the default for an unknown route', () => {
    expect(describeRoute('/something-else')).toBe(DEFAULT_DESCRIPTION);
  });
});

describe('canonical URLs', () => {
  it('drops the query string', () => {
    // The three sample galleries are one page, not three.
    expect(canonicalUrl('/demo/gallery?g=holiday')).toBe(`${SITE_ORIGIN}/demo/gallery`);
    expect(canonicalUrl('/demo/gallery?g=business')).toBe(canonicalUrl('/demo/gallery?g=wedding'));
  });

  it('drops a fragment', () => {
    expect(canonicalUrl('/help#top')).toBe(`${SITE_ORIGIN}/help`);
  });

  it('drops a trailing slash, except on the root', () => {
    expect(canonicalUrl('/pricing/')).toBe(`${SITE_ORIGIN}/pricing`);
    expect(canonicalUrl('/')).toBe(`${SITE_ORIGIN}/`);
  });

  it('uses the same origin the backend sends links from', () => {
    // amplify/backend.ts defaults APP_URL to this. A canonical pointing at the
    // apex while every email points at www splits the site in two.
    expect(SITE_ORIGIN).toBe('https://www.sharepix.net');
  });
});

describe('sitemap', () => {
  const urls = sitemapUrls();

  it('lists every help article', () => {
    for (const article of HELP_ARTICLES) {
      expect(urls).toContain(`${SITE_ORIGIN}/help/${article.slug}`);
    }
  });

  it('lists nothing private', () => {
    const leaked = urls.filter((url) => {
      const path = url.slice(SITE_ORIGIN.length);
      return DISALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
    });
    expect({ leaked }).toEqual({ leaked: [] });
  });

  it('has no duplicates', () => {
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('spells each URL the way that page canonicalises itself', () => {
    // A sitemap entry that disagrees with the page's canonical is a
    // contradiction, and the crawler resolves it by believing the page.
    for (const url of urls) {
      expect(canonicalUrl(url.slice(SITE_ORIGIN.length))).toBe(url);
    }
  });
});

describe('structured data', () => {
  it('describes the organisation without claiming profiles it has none of', () => {
    const org = organizationJsonLd();
    expect(org['@type']).toBe('Organization');
    expect(org.url).toBe(SITE_ORIGIN);
    // An empty sameAs asserts "there are no other profiles"; absence asserts
    // nothing, which is the true state.
    expect(org).not.toHaveProperty('sameAs');
  });

  it('does not declare a site search there is no page for', () => {
    expect(JSON.stringify(webSiteJsonLd())).not.toContain('SearchAction');
  });

  it('offers every sellable tier at the price the pricing page charges', () => {
    const offers = pricingJsonLd().offers as { name: string; price: string }[];
    for (const tier of PRICING_TIERS) {
      const offer = offers.find((o) => o.name === tier.name);
      expect(offer).toBeDefined();
      expect(offer!.price).toBe(tier.price.toFixed(2));
    }
  });

  it('marks the corporate plan as recurring', () => {
    const offers = pricingJsonLd().offers as Record<string, unknown>[];
    const corporate = offers.find((o) => String(o.name).startsWith(CORPORATE_PLAN.name));
    expect(corporate).toBeDefined();
    // Without this a crawler reads $149 as a one-off purchase.
    expect(corporate!.priceSpecification).toMatchObject({ unitCode: 'MON' });
  });

  it('points the share image at a file that is committed', () => {
    expect(existsSync(join(root, 'public', OG_IMAGE_PATH))).toBe(true);
  });
});

describe('the generated files are in step with their source', () => {
  // The failure this catches: somebody adds a help article or a private route,
  // and public/sitemap.xml still describes last month's site because nobody
  // ran the generator. Nothing else would notice until a crawler did.
  it('robots.txt matches what lib/seo.ts would write', () => {
    expect(readFileSync(join(root, 'public', 'robots.txt'), 'utf8')).toBe(robotsTxt());
  });

  it('sitemap.xml matches what lib/seo.ts would write', () => {
    expect(readFileSync(join(root, 'public', 'sitemap.xml'), 'utf8')).toBe(sitemapXml());
  });
});
