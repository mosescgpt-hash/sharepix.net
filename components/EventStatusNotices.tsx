import Link from 'next/link';
import Notice from '@/components/Notice';
import type { EventStatusNotice } from '@/lib/eventStatus';

/**
 * Renders the dashboard's status notices. What they say, and when, is decided
 * in lib/eventStatus.ts; this only lays them out and wires the two actions.
 */
export default function EventStatusNotices({
  notices,
  onPay,
  paying,
  payError,
}: {
  notices: EventStatusNotice[];
  onPay: () => void;
  paying: boolean;
  payError: string | null;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="mt-6 space-y-3">
      {notices.map((notice) => (
        <Notice key={notice.kind} tone={notice.tone} label="">
          <p className="font-semibold">{notice.title}</p>
          <p className="mt-1">{notice.body}</p>
          {notice.kind === 'unpaid' ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={onPay}
                disabled={paying}
                className="spx-btn-ink disabled:opacity-50"
              >
                {paying
                  ? 'Opening checkout…'
                  : notice.priceUsd > 0
                    ? `Pay $${notice.priceUsd} and open uploads`
                    : 'Finish checkout'}
              </button>
              {payError ? <p className="mt-2 text-sm text-red-700">{payError}</p> : null}
            </div>
          ) : null}
          {notice.kind === 'trial' ? (
            <p className="mt-2">
              <Link href="/create-event?tier=plus" className="font-medium underline">
                Start a Full Event — ${notice.upgradePriceUsd}
              </Link>
            </p>
          ) : null}
        </Notice>
      ))}
    </div>
  );
}
