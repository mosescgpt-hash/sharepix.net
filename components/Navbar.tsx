import Link from 'next/link';
import { useState } from 'react';
import Logo from '@/components/Logo';

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = (
    <>
      <Link href="/pricing" className="font-medium text-ink/75 transition hover:text-accent">
        Pricing
      </Link>
      <Link href="/demo" className="font-medium text-ink/75 transition hover:text-accent">
        Example
      </Link>
      <Link href="/my-events" className="font-medium text-ink/75 transition hover:text-accent">
        Host access
      </Link>
      <Link
        href="/create-event"
        className="rounded-full bg-ink px-5 py-2 font-medium text-white shadow-card transition duration-200 ease-out hover:bg-night hover:shadow-lift"
      >
        Create an event
      </Link>
    </>
  );

  return (
    // Translucent over the page wash rather than an opaque bar: the gradient
    // shows through, so the header reads as part of the page instead of a
    // separate strip sitting on top of it.
    <header className="sticky top-0 z-20 border-b border-line/70 bg-smoke/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-xl font-bold tracking-tight"
        >
          <Logo />
          <span className="lowercase">
            share<span className="text-accent">pix</span><span className="text-muted">.net</span>
          </span>
        </Link>

        {/* Mobile menu button */}
        <button
          type="button"
          className="rounded-lg p-2 transition hover:bg-ink/5 sm:hidden"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="block h-0.5 w-5 rounded-full bg-ink" />
          <span className="mt-1 block h-0.5 w-5 rounded-full bg-ink" />
          <span className="mt-1 block h-0.5 w-5 rounded-full bg-ink" />
        </button>

        <div className="hidden items-center gap-6 text-sm sm:flex">{links}</div>
      </nav>
      {menuOpen ? (
        <div className="flex flex-col items-start gap-4 border-t border-line bg-card/90 px-4 py-5 text-sm sm:hidden">
          {links}
        </div>
      ) : null}
    </header>
  );
}
