import Link from 'next/link';
import { useRouter } from 'next/router';
import { signOut } from 'aws-amplify/auth';
import { ReactNode, useState } from 'react';

export type HostSection = 'events' | 'account' | 'security';

const SECTIONS: Array<{ id: HostSection; href: string; label: string }> = [
  { id: 'events', href: '/my-events', label: 'Events' },
  { id: 'account', href: '/account', label: 'Account' },
  { id: 'security', href: '/account-security', label: 'Security' },
];

interface HostHeaderProps {
  eyebrow: string;
  /** Headline line one, bold sans. */
  title: string;
  /** Headline line two, italic serif. Omit for a single-line heading. */
  serif?: string;
  description?: string;
  /** Primary actions for this page, rendered beside the nav. */
  actions?: ReactNode;
  current: HostSection;
  /** Shows the Global admin link. Only ever true for members of ADMINS. */
  admin?: boolean;
}

/**
 * The masthead every signed-in host page shares.
 *
 * Before this, `my-events`, `account` and `account-security` each rendered
 * their own row of pill links, each slightly different, and the dashboard
 * crammed five of them onto one line beside the heading — which is most of
 * what made it read as an admin screen rather than a product. Here the title
 * gets a navy band of its own and navigation is a separate quiet bar beneath
 * it, with the current section marked.
 */
export default function HostHeader({
  eyebrow,
  title,
  serif,
  description,
  actions,
  current,
  admin = false,
}: HostHeaderProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
      await router.replace('/');
    } finally {
      // If sign-out throws the button must come back, or the host is stuck
      // looking at a dead control on a page they are still signed in to.
      setSigningOut(false);
    }
  }

  return (
    <>
      <section className="spx-section-ink py-10 sm:py-14">
        <div className="spx-inner">
          <p className="spx-eyebrow">{eyebrow}</p>
          <h1 className="mt-3">
            <span className="spx-display block">{title}</span>
            {serif ? <span className="spx-display-serif block">{serif}</span> : null}
          </h1>
          {description ? <p className="spx-body mt-4 max-w-lg">{description}</p> : null}
          {actions ? <div className="mt-8 flex flex-wrap gap-3">{actions}</div> : null}
        </div>
      </section>

      <div className="border-b border-charcoal/10 bg-sand">
        <nav
          aria-label="Host"
          className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm sm:px-8"
        >
          {SECTIONS.map((section) => (
            <Link
              key={section.id}
              href={section.href}
              aria-current={section.id === current ? 'page' : undefined}
              className={
                section.id === current
                  ? 'font-medium text-charcoal underline underline-offset-4'
                  : 'text-charcoal/60 transition hover:text-charcoal'
              }
            >
              {section.label}
            </Link>
          ))}
          {admin ? (
            <Link href="/global-admin" className="text-pine transition hover:text-charcoal">
              Global admin
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="ml-auto text-charcoal/60 transition hover:text-charcoal disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
      </div>
    </>
  );
}
