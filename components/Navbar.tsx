import Link from 'next/link';
import { useState } from 'react';
import Logo from '@/components/Logo';

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = (
    <>
      <Link href="/pricing" className="hover:text-accent">
        Pricing
      </Link>
      <Link
        href="/create-event"
        className="rounded-full bg-ink px-4 py-1.5 font-medium text-white hover:bg-night"
      >
        Create an event
      </Link>
      <Link href="/my-events" className="font-medium text-ink/75 hover:text-accent">
        Host access
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-smoke/95 backdrop-blur">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
          <Logo />
          <span className="lowercase">
            share<span className="text-accent">pix</span><span className="text-ink/55">.net</span>
          </span>
        </Link>

        {/* Mobile menu button */}
        <button
          type="button"
          className="rounded p-2 sm:hidden"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="block h-0.5 w-5 bg-ink" />
          <span className="mt-1 block h-0.5 w-5 bg-ink" />
          <span className="mt-1 block h-0.5 w-5 bg-ink" />
        </button>

        <div className="hidden items-center gap-5 text-sm sm:flex">{links}</div>
      </nav>
      {menuOpen ? (
        <div className="flex flex-col items-start gap-4 border-t border-ink/10 px-4 py-4 text-sm sm:hidden">
          {links}
        </div>
      ) : null}
    </header>
  );
}
