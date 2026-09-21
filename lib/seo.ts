/**
 * What each page tells a search engine and a link preview about itself.
 *
 * Before this, every page on SharePix shipped the same title suffix, the same
 * one-sentence description, and nothing else — no canonical, no Open Graph, no
 * robots directive. Three consequences, in descending order of how much they
 * cost:
 *
 * 1. **Every link shared anywhere rendered as a bare URL.** SharePix spreads by
 *    somebody pasting a link into a group chat. With no `og:image` and no
 *    `og:title`, iMessage, WhatsApp, Slack and Facebook all show a grey box and
 *    a hostname. That is the whole first impression of the product, and it was
 *    blank.
 *
 * 2. **Private pages were crawlable.** Nothing said otherwise. A gallery URL
 *    that reached a crawler — pasted into a public forum, sitting in a
 *    referrer, guessed — could be indexed, and the photos in it are guests'.
 *    That is a privacy problem wearing an SEO problem's clothes.
 *
 * 3. **One description across thirty pages.** Google rewrites or ignores a
 *    description that obviously does not match the page, so pricing, help
 *    articles and the demo were all competing with the same sentence.
 *
 * ## The important decision here: default deny
 *
 * {@link isIndexable} works off an allowlist. A route not named in
 * {@link INDEXABLE_ROUTES} is `noindex, nofollow` — so a page added next month
 * is private until somebody decides otherwise, rather than public until
 * somebody notices. That is the correct direction for a product where most
 * routes hold other people's photographs, and it is the one that fails safely
 * when this file is not updated.
 *
 * The guard in `__tests__/seo.test.ts` makes the choice explicit rather than
 * accidental: every route under `pages/` has to be either on the allowlist or
 * on the acknowledged-private list, so adding a page fails the build until
 * somebody says which it is.
 *
 * ## Why `www`
 *
 * `SITE_ORIGIN` matches `APP_URL` in the backend — every email, QR code and
 * printed sign already says `www.sharepix.net`. Canonicals have to agree with
 * the host the links actually use, or they split the same page across two
 * hostnames, which is the exact duplication they exist to prevent.
 */

// Relative, like every other module in lib/ — the node test project does not
// resolve the `@/` alias.
import { HELP_ARTICLES } from './help';
import { CORPORATE_PLAN, PRICING_TIERS } from './pricing';

/**
 * The headline price, read from the tier list rather than typed out.
 *
 * The `/pricing` description quotes a number, and a number typed into a
 * description is a number that keeps saying $79 six months after the price
 * moved. That is the same drift that left four stale help articles
 * contradicting the pricing page.
 */
const PAID_TIER_PRICE = PRICING_TIERS.find((tier) => tier.price > 0)?.price ?? 0;

/**
 * The one hostname SharePix is canonically at.
 *
 * Matches `APP_URL` in amplify/backend.ts. The apex redirects here; it is not
 * a second home for the same pages.
 */
export const SITE_ORIGIN = 'https://www.sharepix.net';

/** Shown when a route has nothing more specific to say. */
export const DEFAULT_DESCRIPTION =
  'One QR code on the table, every guest’s camera, and all the photos in one gallery. No app and no account for guests.';

/**
 * The card image for a shared link. 1200×630, the size every platform crops to.
 *
 * Built from `scripts/og-card.html` — see the note at the top of that file for
 * how to regenerate it. JPEG rather than PNG: the same card is 117 KB against
 * 536 KB, and a scraper that times out fetching the image shows no card at all.
 */
export const OG_IMAGE_PATH = '/og-card.jpg';

/** Used as the `og:site_name` and in structured data. */
export const SITE_NAME = 'SharePix';

/**
 * Routes search engines may index.
 *
 * Next.js route patterns, exactly as `useRouter().route` reports them. Marketing,
 * legal, and help — everything a stranger could usefully land on. Nothing that
 * requires knowing an event, a token, or a login.
 */
export const INDEXABLE_ROUTES = [
  '/',
  '/demo',
  '/demo/gallery',
  '/demo/guestbook',
  '/demo/live',
  '/demo/try',
  '/demo/try-upload',
  '/dmca',
  '/fair-use',
  '/help',
  '/help/[slug]',
  '/join',
  '/pricing',
  '/privacy',
  '/pro',
  '/terms',
] as const;

/**
 * Routes deliberately kept out of search, listed so the guard test can tell
 * "decided against" from "nobody has looked at this yet".
 *
 * Three reasons run through it. Some hold guests' photographs
 * (`/event/...`, `/share/...`). Some carry a single-use token in the path,
 * where indexing would publish the token (`/review/...`, `/rating/...`,
 * `/survey/...`, `/unsubscribe`). The rest are signed-in workspaces with
 * nothing to offer a stranger who found them.
 */
export const PRIVATE_ROUTES = [
  '/account',
  '/account-security',
  '/checkout/success',
  // Not marketing, despite the name. `/corporate` is wrapped in
  // `withAuthenticator`, so what a crawler fetches is a sign-in form — putting
  // it in the sitemap would submit a login wall to Google as a product page.
  // The Corporate plan is sold on /pricing, which is public.
  '/corporate',
  '/create-event',
  '/event/[eventId]',
  '/event/[eventId]/admin',
  '/event/[eventId]/brochure',
  '/event/[eventId]/guestbook',
  '/event/[eventId]/live',
  '/event/[eventId]/table-tent',
  '/event/[eventId]/upload',
  '/featured/[eventId]',
  '/global-admin',
  '/my-events',
  '/pro/join',
  '/pro/events/[eventId]/review',
  '/rating/[link]',
  '/review/[token]',
  '/share/[shareId]',
  '/survey/[link]',
  '/unsubscribe',
] as const;

const INDEXABLE = new Set<string>(INDEXABLE_ROUTES);

/** Whether a route pattern may be indexed. Unknown routes are not. */
export function isIndexable(route: string): boolean {
  return INDEXABLE.has(route);
}

/**
 * What each indexable page says about itself.
 *
 * Written to describe the page rather than the product — a description that
 * does not match what a searcher then reads is the one Google throws away.
 * `/help/[slug]` is absent on purpose: those come from each article's own
 * summary, in {@link describeRoute}.
 */
export const ROUTE_DESCRIPTIONS: Record<string, string> = {
  '/': DEFAULT_DESCRIPTION,
  '/demo': 'A worked example of a SharePix event, set up exactly the way a real one would be. Look around before you pay for anything.',
  '/demo/gallery':
    'Three sample galleries — a wedding, a company party, and a family holiday — showing what your guests see after they upload.',
  '/demo/guestbook':
    'The digital guest book: guests leave a signed note, a photo, or a short video message alongside the gallery.',
  '/demo/live': 'The live slideshow, as it runs on a venue screen. New photos appear on their own, moments after a guest uploads them.',
  '/demo/try': 'Walk through setting up a SharePix event, step by step, without creating an account or paying anything.',
  '/demo/try-upload':
    'Add a photo to a sample gallery from your own phone, the way a guest at your event would. No app and no account, and your photo is deleted within the hour.',
  '/dmca': 'How to report copyrighted material on sharepix.net, and the designated agent for notices under 17 U.S.C. § 512(c).',
  '/fair-use': 'What “unlimited” means on SharePix, in plain numbers — the limits that exist, when they apply, and what happens if you reach one.',
  '/help': 'Answers for guests adding photos and for hosts running an event — uploads, QR codes, downloads, video, and how long a gallery lasts.',
  '/join': 'Got an event code but no QR code to scan? Type the code here to open the gallery and add your photos.',
  '/pricing': `One price per event, not per guest and not per photo. A free event to try it, then $${PAID_TIER_PRICE} for the full thing. No subscription.`,
  '/privacy': 'What sharepix.net collects, how long photos are kept, who can see them, and how to have your data deleted.',
  '/pro':
    'SharePix Pro for photographers: your shots reach the event gallery within minutes as previews you approve, while you keep the originals and the print sales.',
  '/terms': 'The terms of service for sharepix.net — what we provide, what we do not, and how refunds and outages are handled.',
};

/**
 * The description for a page.
 *
 * `query` is the resolved route parameters, used only by `/help/[slug]`, where
 * every article already carries a one-line summary written for a human. Those
 * are better than anything that could be generated here, and there are enough
 * of them that keeping a second copy would guarantee the two drift.
 */
export function describeRoute(
  route: string,
  query: Record<string, string | string[] | undefined> = {},
): string {
  if (route === '/help/[slug]') {
    const slug = typeof query.slug === 'string' ? query.slug : null;
    const article = slug ? HELP_ARTICLES.find((a) => a.slug === slug) : null;
    if (article) return article.summary;
    return ROUTE_DESCRIPTIONS['/help'];
  }
  return ROUTE_DESCRIPTIONS[route] ?? DEFAULT_DESCRIPTION;
}

/**
 * The absolute URL a page wants to be known by.
 *
 * Query strings are dropped. `/demo/gallery?g=holiday` is the same page as
 * `/demo/gallery` with a different sample selected, and treating the three as
 * separate URLs would divide whatever authority the one page earns by three.
 * A trailing slash is dropped for the same reason, except on the root.
 */
export function canonicalUrl(asPath: string): string {
  const path = asPath.split('?')[0].split('#')[0];
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return `${SITE_ORIGIN}${trimmed || '/'}`;
}

/**
 * Every URL that belongs in the sitemap, in the order a person would meet them.
 *
 * Built from {@link INDEXABLE_ROUTES} rather than kept beside it, so a page
 * cannot be indexable and missing from the sitemap at the same time. The one
 * dynamic route is expanded from the article list.
 */
export function sitemapUrls(): string[] {
  return INDEXABLE_ROUTES.flatMap((route) =>
    route === '/help/[slug]'
      ? HELP_ARTICLES.map((article) => `${SITE_ORIGIN}/help/${article.slug}`)
      : // Spelled the same way canonicalUrl spells it, root included. A
        // sitemap entry that disagrees with the page's own canonical is a
        // contradiction the crawler has to resolve, and it resolves it by
        // trusting the page and distrusting the sitemap.
        [canonicalUrl(route)],
  );
}

/**
 * The path prefixes robots.txt refuses.
 *
 * Derived from {@link PRIVATE_ROUTES} by hand rather than generated, because
 * robots.txt matches on prefixes and the mapping is not mechanical: `/event/`
 * covers six routes, and `/pro/` must not be disallowed wholesale because
 * `/pro` itself is the photographer landing page.
 *
 * This is a second line, not the line. `noindex` on the page is what actually
 * keeps a URL out of an index — a disallowed URL can still be listed if it is
 * linked from elsewhere, precisely because the crawler is not allowed to fetch
 * it and read the directive. Both, for the same reason the event codes and the
 * rate limit are both there.
 */
export const DISALLOWED_PREFIXES = [
  '/account',
  '/account-security',
  '/checkout/',
  '/corporate',
  '/create-event',
  '/event/',
  '/featured/',
  '/global-admin',
  '/my-events',
  '/pro/join',
  '/pro/events/',
  '/rating/',
  '/review/',
  '/share/',
  '/survey/',
  '/unsubscribe',
] as const;

/**
 * Who SharePix is, for a search engine.
 *
 * Emitted on the homepage only. Repeating an Organization block on every page
 * does not strengthen it; it just gives a crawler thirty copies to reconcile.
 *
 * `sameAs` is deliberately absent rather than empty: it lists the profiles that
 * confirm this is the same entity elsewhere, and SharePix does not yet have any
 * to point at. An empty array is a claim that there are none.
 */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    logo: `${SITE_ORIGIN}${OG_IMAGE_PATH}`,
    email: 'info@sharepix.net',
    description: DEFAULT_DESCRIPTION,
  };
}

/**
 * The site itself, so a search engine can name it in a results page.
 *
 * No `SearchAction`. That markup exists to offer a site-search box under the
 * result, and SharePix has no site search to wire it to — declaring one that
 * 404s is worse than declaring nothing.
 */
export function webSiteJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    description: DEFAULT_DESCRIPTION,
  };
}

/**
 * The product and what it costs.
 *
 * `SoftwareApplication` rather than `Product`: the latter wants a physical
 * thing with a brand and a GTIN, and Google's product rich results are built
 * around retail. This is web software, and the type says so.
 *
 * The offers are built from `PRICING_TIERS` rather than typed out, so the
 * structured data cannot end up quoting a price the pricing page has stopped
 * charging — which is exactly the drift that put four of the eight
 * customer-facing contradictions on the help articles.
 */
export function pricingJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    url: `${SITE_ORIGIN}/pricing`,
    description: ROUTE_DESCRIPTIONS['/pricing'],
    offers: [
      ...PRICING_TIERS.map((tier) => ({
        '@type': 'Offer',
        name: tier.name,
        price: tier.price.toFixed(2),
        priceCurrency: 'USD',
        url: `${SITE_ORIGIN}/pricing`,
      })),
      {
        '@type': 'Offer',
        name: `${CORPORATE_PLAN.name} plan`,
        price: CORPORATE_PLAN.price.toFixed(2),
        priceCurrency: 'USD',
        // The only recurring offer. Without the specification a crawler reads
        // $149 as a one-off, which is four-figures wrong over a year.
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: CORPORATE_PLAN.price.toFixed(2),
          priceCurrency: 'USD',
          billingDuration: 1,
          billingIncrement: 1,
          unitCode: 'MON',
        },
        // /pricing, not /corporate: the latter is the signed-in subscribe page.
        url: `${SITE_ORIGIN}/pricing`,
      },
    ],
  };
}

/**
 * The body of robots.txt.
 *
 * Lives here rather than in the script that writes it so a test can compare the
 * committed file against it — the failure mode of a generated-and-committed
 * file is that somebody edits the source and forgets to rerun the generator,
 * and the only thing that catches that is a test holding both.
 *
 * One group, no blank line inside it: a blank line ends a record in robots.txt,
 * and a `Disallow` that follows one belongs to no `User-agent` and is dropped.
 */
export function robotsTxt(): string {
  return [
    '# Generated by scripts/build-seo-files.ts — do not edit by hand.',
    '',
    'User-agent: *',
    ...DISALLOWED_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    // Next's own routes. Nothing under here is a page.
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * The body of sitemap.xml.
 *
 * `<loc>` and nothing else. Google ignores `<changefreq>` and `<priority>`
 * outright and has said so; `<lastmod>` it does use, but only when it is
 * accurate, and the build has no honest per-page modification date to give it.
 * Stamping every URL with the build time would make the file claim the whole
 * site changed on every deploy, which is worse than saying nothing.
 */
export function sitemapXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Generated by scripts/build-seo-files.ts — do not edit by hand. -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapUrls().map((loc) => `  <url><loc>${loc}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}
