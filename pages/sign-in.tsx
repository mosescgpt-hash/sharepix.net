import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { withHostAuth } from '@/components/hostAuth';
import { signOutAndGoHome, useAuthUser } from '@/lib/authUser';

/** Shown inside the authenticator: they have just signed in, so take them on. */
function JustSignedIn() {
  const router = useRouter();
  useEffect(() => {
    void router.replace('/my-events');
  }, [router]);
  return <p className="p-10 text-center text-sm text-charcoal/70">Signed in. Taking you to your events…</p>;
}

const SignInForm = withHostAuth(JustSignedIn, {
  purpose: 'Sign in to SharePix.',
  arriving: 'returning',
  title: 'Sign in',
});

/**
 * `/sign-in`, where the header's "Sign in" goes. A host who is already signed
 * in sees who they are and where to go, not a form.
 */
export default function SignInPage() {
  const user = useAuthUser();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  if (user.status === 'loading') {
    return (
      <Layout title="Sign in" noindex>
        <p className="py-16 text-center text-sm text-charcoal/60" aria-busy="true">
          Checking your account…
        </p>
      </Layout>
    );
  }
  if (user.status === 'out') return <SignInForm />;

  const who = user.email ?? (user.label === 'My account' ? null : user.label);
  return (
    <Layout title="Signed in" noindex>
      <div className="spx-card mx-auto my-16 max-w-md p-8 text-center">
        <h1 className="font-sans text-xl font-bold">
          {who ? <>You&apos;re signed in as {who}</> : <>You&apos;re signed in</>}
        </h1>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/my-events" className="spx-btn-ink px-6 py-3 text-sm">
            Go to my events
          </Link>
          <button
            type="button"
            disabled={signingOut}
            className="spx-btn-outline px-6 py-3 text-sm disabled:opacity-50"
            onClick={async () => {
              setSigningOut(true);
              try {
                await signOutAndGoHome(router.replace);
              } finally {
                setSigningOut(false);
              }
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </Layout>
  );
}
