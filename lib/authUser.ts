import { useEffect, useState } from 'react';

/**
 * Who is signed in, for the site header and the sign-in page.
 *
 * `loading` until the auth library has answered, so the header can show a
 * neutral placeholder instead of flashing "Sign in" at a signed-in host (the
 * server render never knows). Any failure — Amplify not configured, offline,
 * no session — reads as signed out.
 */
export type AuthUser = { status: 'loading' } | { status: 'out' } | { status: 'in'; label: string; email: string | null };

/** First name if we have one, else a masked email, else "My account". */
export function accountLabel(attrs: { given_name?: string; name?: string; email?: string }): string {
  const first = (attrs.given_name ?? attrs.name ?? '').trim().split(/\s+/)[0];
  if (first) return first.slice(0, 24);
  const email = attrs.email?.trim();
  if (email && email.includes('@')) {
    const [user, domain] = email.split('@');
    return `${user.slice(0, 1)}***@${domain}`;
  }
  return 'My account';
}

async function readUser(): Promise<AuthUser> {
  try {
    const { Amplify } = await import('aws-amplify');
    if (!Amplify.getConfig().Auth) return { status: 'out' };
    const auth = await import('aws-amplify/auth');
    await auth.getCurrentUser();
    let attrs: Record<string, string | undefined> = {};
    try {
      attrs = await auth.fetchUserAttributes();
    } catch {
      // Offline or throttled: still signed in, just no name to show.
    }
    return { status: 'in', label: accountLabel(attrs), email: attrs.email ?? null };
  } catch {
    return { status: 'out' };
  }
}

export function useAuthUser(): AuthUser {
  const [user, setUser] = useState<AuthUser>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    const refresh = () => void readUser().then((u) => live && setUser(u));
    refresh();
    let stop: (() => void) | undefined;
    void import('aws-amplify/utils')
      .then(({ Hub }) => {
        if (!live) return;
        stop = Hub.listen('auth', ({ payload }) => {
          if (payload.event === 'signedOut') setUser({ status: 'out' });
          else if (payload.event === 'signedIn' || payload.event === 'tokenRefresh') refresh();
        });
      })
      .catch(() => {});
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  return user;
}

/** The existing sign-out, then home. */
export async function signOutAndGoHome(replace: (url: string) => Promise<unknown>): Promise<void> {
  const { signOut } = await import('aws-amplify/auth');
  await signOut();
  await replace('/');
}
