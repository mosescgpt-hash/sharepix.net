import Link from 'next/link';
import { LAUNCH_PROMO_TEXT, SHOW_LAUNCH_PROMO } from '@/lib/launchPromo';

/**
 * The launch-offer banner. Switched on and off by `SHOW_LAUNCH_PROMO` in
 * lib/launchPromo.ts, which also holds the wording.
 */
export default function OfferBanner() {
  if (!SHOW_LAUNCH_PROMO) return null;
  return (
    <div className="bg-pine text-canvas">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-1 px-5 py-3 text-center text-sm sm:flex-row sm:gap-4 sm:px-8">
        <p className="font-medium">{LAUNCH_PROMO_TEXT}</p>
        <Link
          href="/create-event"
          className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2"
        >
          Create an event
        </Link>
      </div>
    </div>
  );
}
