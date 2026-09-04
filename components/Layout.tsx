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
    <div className="flex min-h-screen flex-col bg-smoke font-body text-ink">
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
      <footer className="mt-auto bg-night text-white">
        {/* A hairline, not a 4px slab. The old mint bar was the loudest thing
            on every page and read as a template accent. */}
        <div className="h-px bg-gradient-to-r from-transparent via-mint/50 to-transparent" />
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-xs">
              <p className="font-display text-lg font-bold tracking-tight">
                share<span className="text-mint">pix</span>
                <span className="text-white/45">.net</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                Capture. Connect. Celebrate. Every photo your guests took, in one
                gallery — pay per event, or take the Corporate plan monthly.
              </p>
            </div>
            <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:gap-x-16">
              {FOOTER_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-white/65 transition hover:text-mint"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="mt-10 flex flex-col gap-2 border-t border-white/10 pt-6 text-sm text-white/45 sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} sharepix.net</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="transition hover:text-mint">
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
