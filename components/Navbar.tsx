import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Logo from '@/components/Logo';

const LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Example' },
  { href: '/my-events', label: 'Host access' },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  // Without this the panel stays open across a client-side navigation and
  // covers the page the visitor just asked for.
  useEffect(() => {
    const close = () => setMenuOpen(false);
    router.events.on('routeChangeComplete', close);
    return () => router.events.off('routeChangeComplete', close);
  }, [router.events]);

  return (
    // Opaque canvas rather than a translucent blur. The redesign marks
    // sections by changing the background edge to edge, and a see-through
    // header over a navy section shows the navy through the bar.
    <header className="sticky top-0 z-30 border-b border-charcoal/10 bg-canvas/95 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2 font-sans text-lg font-bold tracking-[-0.02em] text-charcoal"
        >
          <Logo />
          <span className="lowercase">
            share<span className="text-pine">pix</span>
            <span className="text-charcoal/40">.net</span>
          </span>
        </Link>

        <button
          type="button"
          className="-mr-2 p-2 sm:hidden"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="block h-px w-6 bg-charcoal" />
          <span className="mt-[7px] block h-px w-6 bg-charcoal" />
          <span className="mt-[7px] block h-px w-6 bg-charcoal" />
        </button>

        <div className="hidden items-center gap-8 sm:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-sans text-sm text-charcoal/75 transition hover:text-charcoal"
            >
              {link.label}
            </Link>
          ))}
          <Link href="/create-event" className="spx-btn-ink px-6 py-3 text-sm">
            Create an event
          </Link>
        </div>
      </nav>

      {menuOpen ? (
        <div
          id="primary-navigation"
          className="flex flex-col gap-1 border-t border-charcoal/10 bg-canvas px-5 pb-6 pt-2 sm:hidden"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="border-b border-charcoal/10 py-4 font-sans text-base text-charcoal"
            >
              {link.label}
            </Link>
          ))}
          <Link href="/create-event" className="spx-btn-ink mt-5 w-full">
            Create an event
          </Link>
        </div>
      ) : null}
    </header>
  );
}
