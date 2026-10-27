import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Logo from '@/components/Logo';
import { signOutAndGoHome, useAuthUser } from '@/lib/authUser';

const LINKS = [
  { href: '/weddings', label: 'Weddings' },
  { href: '/company-events', label: 'Company events' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Example' },
];

const ACCOUNT_LINKS = [
  { href: '/my-events', label: 'My events' },
  { href: '/create-event', label: 'Create event' },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const user = useAuthUser();
  const [accountOpen, setAccountOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutAndGoHome(router.replace);
    } finally {
      setSigningOut(false);
      setAccountOpen(false);
    }
  }

  // Without this the panel stays open across a client-side navigation and
  // covers the page the visitor just asked for.
  useEffect(() => {
    const close = () => {
      setMenuOpen(false);
      setAccountOpen(false);
    };
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
          className="flex min-h-[44px] items-center gap-2 font-sans text-lg font-bold tracking-[-0.02em] text-charcoal"
        >
          <Logo />
          <span className="lowercase">
            share<span className="text-pine">pix</span>
            <span className="text-charcoal/70">.net</span>
          </span>
        </Link>

        <button
          type="button"
          className="-mr-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center p-2 sm:hidden"
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
          {user.status === 'loading' ? (
            <span aria-hidden="true" data-testid="auth-placeholder" className="inline-block h-4 w-16 rounded bg-charcoal/10" />
          ) : user.status === 'out' ? (
            <Link href="/sign-in" className="font-sans text-sm text-charcoal/75 transition hover:text-charcoal">
              Sign in
            </Link>
          ) : (
            <div className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-controls="account-menu"
                onClick={() => setAccountOpen((o) => !o)}
                className="font-sans text-sm text-charcoal/75 transition hover:text-charcoal"
              >
                {user.label === 'My account' ? 'My account' : `Hi, ${user.label}`} ▾
              </button>
              {accountOpen ? (
                <div
                  id="account-menu"
                  role="menu"
                  className="absolute right-0 mt-3 w-44 border border-charcoal/10 bg-canvas py-1 shadow-lg"
                >
                  {ACCOUNT_LINKS.map((link) => (
                    <Link key={link.href} href={link.href} role="menuitem" className="block px-4 py-2 text-sm text-charcoal hover:bg-charcoal/5">
                      {link.label}
                    </Link>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={signingOut}
                    onClick={handleSignOut}
                    className="block w-full px-4 py-2 text-left text-sm text-charcoal hover:bg-charcoal/5 disabled:opacity-50"
                  >
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              ) : null}
            </div>
          )}
          {user.status === 'in' ? null : (
            <Link href="/create-event" className="spx-btn-ink px-6 py-3 text-sm">
              Create an event
            </Link>
          )}
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
          {user.status === 'loading' ? (
            <span aria-hidden="true" className="block border-b border-charcoal/10 py-4">
              <span className="inline-block h-4 w-20 rounded bg-charcoal/10" />
            </span>
          ) : user.status === 'out' ? (
            <Link href="/sign-in" className="border-b border-charcoal/10 py-4 font-sans text-base text-charcoal">
              Sign in
            </Link>
          ) : (
            <>
              <p className="pt-4 text-xs uppercase tracking-wide text-charcoal/60">
                Signed in{user.label === 'My account' ? '' : ` as ${user.label}`}
              </p>
              <Link href="/my-events" className="border-b border-charcoal/10 py-4 font-sans text-base text-charcoal">
                My events
              </Link>
              <button
                type="button"
                disabled={signingOut}
                onClick={handleSignOut}
                className="border-b border-charcoal/10 py-4 text-left font-sans text-base text-charcoal disabled:opacity-50"
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          )}
          <Link href="/create-event" className="spx-btn-ink mt-5 w-full">
            Create an event
          </Link>
        </div>
      ) : null}
    </header>
  );
}
