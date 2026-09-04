import Head from 'next/head';
import Link from 'next/link';
import { ReactNode } from 'react';
import Navbar from '@/components/Navbar';
import { SUPPORT_EMAIL } from '@/lib/help';

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
  children: ReactNode;
}

const FOOTER_LINKS = [
  { href: '/help', label: 'Help' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'See an example' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/terms', label: 'Terms of Service' },
  // Safe harbour under 17 U.S.C. § 512(c) requires the designated agent's
  // details to be reachable from the site, not only filed with the Copyright
  // Office. This link is part of that.
  { href: '/dmca', label: 'Copyright / DMCA' },
];

export default function Layout({ title, width = 'default', children }: LayoutProps) {
  const pageTitle = title
    ? `${title} — sharepix.net`
    : 'sharepix.net — Capture. Connect. Celebrate.';
  return (
    <div className="flex min-h-screen flex-col bg-canvas font-sans text-charcoal">
      <Head>
        <title>{pageTitle}</title>
        <meta
          name="description"
          content="Every guest is a photographer. Create an event, print a QR code, and collect everyone's photos in one gallery."
        />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
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
