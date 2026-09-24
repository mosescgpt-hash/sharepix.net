import Link from 'next/link';

export type GuestReferralSource = 'guest_upload' | 'gallery';

/**
 * The guest-to-host loop: a quiet, single link inviting whoever is looking at
 * someone else's event to start their own. Never a button, never beside the
 * page's main action — a guest came here to add a photo, browse a gallery, or
 * sign a guest book, not to be sold to.
 *
 * `source` becomes `?source=` on the link, which pages/create-event.tsx
 * already reads and stamps on the new event's row — see lib/attribution.ts.
 * Originally shipped only in the upload success state (components/UploadForm.tsx);
 * pulled out here so the gallery and guest book pages say the exact same thing
 * rather than each inventing their own wording.
 */
export default function GuestReferralLink({ source }: { source: GuestReferralSource }) {
  return (
    <p className="mt-6 border-t border-charcoal/10 pt-4 text-sm text-charcoal/60">
      Planning an event of your own?{' '}
      <Link href={`/create-event?source=${source}`} className="font-medium text-pine underline">
        Create your own SharePix
      </Link>
    </p>
  );
}
