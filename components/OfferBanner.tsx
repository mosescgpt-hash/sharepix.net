import Link from 'next/link';
import { LAUNCH_PROMO_TEXT, SHOW_LAUNCH_PROMO } from '@/lib/launchPromo';

/**
 * The launch-offer banner. Switched on and off by `SHOW_LAUNCH_PROMO` in
 * lib/launchPromo.ts, which also holds the wording.
 *
 * The whole strip is one link, so the tap target is the banner itself and the
 * "Create an event" prompt costs no extra line on a phone.
 */
export default function OfferBanner() {
  if (!SHOW_LAUNCH_PROMO) return null;
  return (
    <div className="bg-pine text-canvas">
      <Link
        href="/create-event"
        className="mx-auto flex min-h-[44px] max-w-6xl flex-wrap items-center justify-center gap-x-3 px-5 py-2 text-center text-[0.8rem] leading-snug sm:px-8 sm:text-sm"
      >
        <span className="font-medium">{LAUNCH_PROMO_TEXT}</span>
        <span className="font-semibold underline underline-offset-2">Create an event</span>
      </Link>
    </div>
  );
}
