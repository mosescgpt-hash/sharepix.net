import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode } from 'react';
import Navbar from '@/components/Navbar';
import { SUPPORT_EMAIL } from '@/lib/help';
import {
  OG_IMAGE_PATH,
  SITE_NAME,
  SITE_ORIGIN,
  canonicalUrl,
  describeRoute,
  isIndexable,
} from '@/lib/seo';

interface LayoutProps {
  title?: string;
  /**
   * `wide` gives the page a 1152px column instead of 1024px. Four pricing
   * columns in the narrow one leave ~230px per card, which wraps feature lines
   * after three words — the single most "unfinished" thing on the site.
   *
   * `bleed` removes the column and the padding entirely so a page can paint
   * edge-to-edge colour blocks. The redesign marks sections by changing the
   * background, which a centred max-width column cannot do. Pages using it
   * supply their own horizontal padding, normally via `.spx-section`.
   */
  width?: 'default' | 'wide' | 'bleed';
  /**
   * Overrides the description `lib/seo.ts` holds for this route.
   *
   * For pages whose subject is not fixed by the route — a help article, a demo
   * gallery the visitor switched. Most pages should leave this alone and put
   * their description in `ROUTE_DESCRIPTIONS`, where it sits next to every
   * other page's and can be read as a set.
   */
  description?: string;
  /**
   * Force this page out of search regardless of the allowlist.
   *
   * An escape hatch for a page that is public but shows something specific to
   * one person. It can only ever add `noindex`, never remove it — a page the
   * allowlist calls private stays private whatever is passed here.
   */
  noindex?: boolean;
  /** JSON-LD for this page, already an object. Emitted as a script tag. */
  structuredData?: Record<string, unknown> | Record<string, unknown>[];
  children: ReactNode;
}

const FOOTER_LINKS = [
  { href: '/help', label: 'Help' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'See an example' },
  // Photographers, not hosts. In the footer rather than the header because a
  // photographer arrives knowing what they are looking for — usually with a
  // pairing code in hand — while a host arriving cold does not need a fourth
  // thing competing with "Create an event".
  { href: '/pro', label: 'For photographers' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  // Safe harbour under 17 U.S.C. § 512(c) requires the designated agent's
  // details to be reachable from the site, not only filed with the Copyright
  // Office. This link is part of that.
  { href: '/dmca', label: 'Copyright / DMCA' },
];

export default function Layout({
  title,
  width = 'default',
  description,
  noindex = false,
  structuredData,
  children,
}: LayoutProps) {
  const router = useRouter();
  // `route` is the pattern ("/help/[slug]"); `asPath` is what the visitor is
  // actually on. The allowlist is keyed by the pattern, the canonical by the
  // real path.
  const route = router?.route ?? '/';
  const asPath = router?.asPath ?? '/';

  const pageTitle = title
    ? `${title} — sharepix.net`
    : 'sharepix.net — Capture. Connect. Celebrate.';
  const pageDescription = description ?? describeRoute(route, router?.query ?? {});
  // `noindex` can only ever tighten this. A page the allowlist says is private
  // cannot be opened up by a prop somebody passed without thinking about it.
  const indexable = isIndexable(route) && !noindex;
  const canonical = canonicalUrl(asPath);
  const ogImage = `${SITE_ORIGIN}${OG_IMAGE_PATH}`;

  return (
    <div className="flex min-h-screen flex-col bg-canvas font-sans text-charcoal">
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta
          name="robots"
          content={
            indexable
              ? 'index, follow, max-image-preview:large'
              : // `nofollow` as well, so a crawler that reaches a gallery does
                // not walk from it to every photo and share link inside it.
                'noindex, nofollow'
          }
        />
        {/* Only on pages that may be indexed. A canonical on a noindex page is
            at best ignored and at worst read as a request to index the target
            in its place. */}
        {indexable ? <link rel="canonical" href={canonical} /> : null}

        {/* Open Graph. This is what a link pasted into a group chat becomes,
            which for this product is most of how anyone first sees it. */}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={ogImage} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta
          property="og:image:alt"
          content="sharepix.net — Every moment. Everyone’s perspective. Guests at a wedding table photographing the couple on their phones."
        />

        {/* Twitter/X reads its own names and falls back to og: for the rest. */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content={ogImage} />

        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

        {structuredData ? (
          <script
            type="application/ld+json"
            // The object is built in our own code from our own constants, never
            // from anything a visitor typed.
            dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
          />
        ) : null}
      </Head>
      <Navbar />
      <main
        className={
          width === 'bleed'
            ? 'w-full flex-1'
            : `mx-auto w-full flex-1 px-4 pb-20 pt-8 sm:px-6 ${
                width === 'wide' ? 'max-w-6xl' : 'max-w-5xl'
              }`
        }
      >
        {children}
      </main>
      {/* Square, navy, no gradient hairline. The footer is the last full-bleed
          colour block on every page rather than a decorated strip. */}
      <footer className="mt-auto bg-ink text-canvas">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
          <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xs">
              <p className="font-sans text-lg font-bold tracking-[-0.02em]">
                share<span className="text-mint">pix</span>
                <span className="text-canvas/40">.net</span>
              </p>
              <p className="mt-4 font-serif text-xl italic leading-snug text-canvas/85">
                Every moment. Everyone&rsquo;s perspective.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-canvas/60">
                One gallery for every photo your guests took. Pay per event, or take the
                Corporate plan monthly.
              </p>
            </div>
            <nav
              aria-label="Footer"
              className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:gap-x-16"
            >
              {FOOTER_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-canvas/65 transition hover:text-mint"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-12 flex flex-col gap-2 border-t border-canvas/15 pt-6 text-sm text-canvas/45 sm:flex-row sm:items-center sm:justify-between">
            <p>&copy; {new Date().getFullYear()} sharepix.net</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="transition hover:text-mint">
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
