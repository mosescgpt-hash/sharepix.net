import type { ComponentType } from 'react';
import Link from 'next/link';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Logo from '@/components/Logo';

/**
 * The sign-in screen a host actually meets.
 *
 * ## What was there
 *
 * Eight pages wrapped themselves in a bare `withAuthenticator(Page)`. That
 * renders Amplify's default card on an empty white page: no wordmark, no
 * navigation, nothing saying what the person had been doing — and defaulting to
 * **Sign In** on every one of them, including `/create-event`, which is where
 * somebody arrives from the homepage having never heard of us.
 *
 * So the last thing a prospect saw was "Create an event gallery", and the next
 * thing was an unbranded box asking for a password they do not have. The Create
 * Account tab exists; it is a second click, on a screen that looks like it
 * belongs to a different product.
 *
 * ## Two kinds of page
 *
 * `new` is a page a stranger can land on — `/create-event`, `/corporate`. It
 * opens on Create Account, because that is what they are doing.
 *
 * `returning` is a page you can only want if you already have an event —
 * `/my-events`, the event dashboards, `/account`. Sign In is right there.
 *
 * Getting this backwards is not symmetrical. A returning host shown Create
 * Account has one extra click; a prospect shown Sign In is being asked for
 * something they do not have, which reads as a wall.
 *
 * ## The sentence about guests
 *
 * Every page here says it, because this is the exact moment somebody wonders
 * whether their guests will have to do this too. The answer — they never do —
 * is one of the few things SharePix can say that is both a real product
 * property and the thing being doubted.
 */

export interface HostAuthOptions {
  /** What this person was in the middle of. One line, sentence case. */
  purpose: string;
  /**
   * `new` for a page somebody can arrive at from marketing, `returning` for one
   * that only makes sense if they already have an account.
   */
  arriving: 'new' | 'returning';
}

function AuthHeader({ purpose, arriving }: HostAuthOptions) {
  return (
    <div className="mx-auto w-full max-w-md px-5 pb-6 pt-10 text-center">
      <Link
        href="/"
        className="inline-flex items-center gap-2 font-sans text-lg font-bold tracking-[-0.02em] text-charcoal"
      >
        <Logo />
        <span className="lowercase">
          share<span className="text-pine">pix</span>
          <span className="text-charcoal/40">.net</span>
        </span>
      </Link>
      <p className="mt-5 font-sans text-base font-semibold text-charcoal">{purpose}</p>
      <p className="mt-2 text-sm text-charcoal/70">
        {arriving === 'new'
          ? 'Hosts need an account so an event has an owner. Your guests never make one — they scan a code and start sending photos.'
          : 'Sign in to the account that owns the event.'}
      </p>
    </div>
  );
}

function AuthFooter() {
  return (
    <div className="mx-auto w-full max-w-md px-5 pb-12 pt-6 text-center text-sm text-charcoal/70">
      <Link href="/" className="underline">
        Back to sharepix.net
      </Link>
    </div>
  );
}

/**
 * Wrap a host-only page in the branded sign-in screen.
 *
 * A drop-in replacement for `withAuthenticator(Page)`, which is what every one
 * of these pages used to call directly.
 */
export function withHostAuth<P extends object>(
  Component: ComponentType<P>,
  options: HostAuthOptions,
) {
  return withAuthenticator(Component as ComponentType<object>, {
    initialState: options.arriving === 'new' ? 'signUp' : 'signIn',
    components: {
      Header: () => <AuthHeader {...options} />,
      Footer: AuthFooter,
    },
  });
}
