import Link from 'next/link';

/**
 * The SHAREFREE launch offer. The wording is fixed by the owner and used
 * word-for-word in marketing, so change it in one place only: here.
 */
export const SHAREFREE_OFFER =
  'The first 20 events booked with code SHAREFREE are free. That\u2019s 20 total, first come, first served.';

export default function OfferBanner() {
  return (
    <div className="bg-pine text-canvas">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-2 px-5 py-3 text-center text-sm sm:flex-row sm:gap-4 sm:px-8">
        <p className="font-medium">{SHAREFREE_OFFER}</p>
        <Link href="/create-event" className="font-semibold underline underline-offset-2">
          Create an event
        </Link>
      </div>
    </div>
  );
}
