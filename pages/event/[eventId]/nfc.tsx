import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { withHostAuth } from '@/components/hostAuth';
import NfcOrderCard from '@/components/signKit/NfcOrderCard';
import { eventUploadUrl } from '@/lib/signKit/content';
import { useHostEvent } from '@/lib/signKit/useHostEvent';

/**
 * How to put an NFC sticker behind the "or tap here" mark on a sign.
 *
 * The link copied here is the one the sign's QR encodes (eventUploadUrl), so
 * a tap and a scan open the same guest page.
 */
function NfcPage() {
  const { eventId, event, loading, denied, error } = useHostEvent();
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (event) setLink(eventUploadUrl(window.location.origin, event.id));
  }, [event]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('yes');
    } catch {
      // Older or locked-down browsers: select it so a long-press copies it.
      inputRef.current?.select();
      setCopied('manual');
    }
  };

  const steps = [
    {
      title: 'Buy NTAG213 or NTAG215 stickers',
      body: 'Either works; the link fits easily on both. For a metal surface, buy the on-metal type, because a plain tag won’t read on metal.',
    },
    {
      title: 'Install a free NFC writer app',
      body: 'For example NFC Tools, on iPhone or Android.',
    },
    {
      title: 'Write your event link to the tag',
      body: 'Tap “Copy event link” below. In the app choose Write, add a record, pick URL, paste the link, then hold the tag to your phone.',
    },
    {
      title: 'Lock the tag',
      body: 'In the app’s Other menu, choose “Lock tag”. Then nobody can rewrite it to point somewhere else. Locking is permanent, so test the tag first.',
    },
    {
      title: 'Stick it behind the “tap here” mark',
      body: 'On the back of the sign, directly behind the mark. Card stock is fine; a thick frame or metal stand is not.',
    },
    {
      title: 'Test it with both kinds of phone',
      body: 'iPhone reads at its top edge. Android reads at the centre of its back. It should open your upload page.',
    },
  ];

  return (
    <div className="min-h-screen bg-canvas font-sans text-charcoal">
      <Head>
        <title>NFC tap tags — sharepix.net</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href={eventId ? `/event/${eventId}/signs` : '/my-events'}
            className="text-sm font-medium text-charcoal/70 transition hover:text-charcoal"
          >
            ← Back to signs
          </Link>
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {loading ? (
          <p className="text-center text-charcoal/60">Loading…</p>
        ) : denied ? (
          <p className="mx-auto max-w-lg rounded-xl bg-amber-50 px-4 py-6 text-center text-amber-800">
            Only the event host or a sharepix.net global administrator can open this page.
          </p>
        ) : error ? (
          <p className="mx-auto max-w-lg rounded-xl bg-red-50 px-4 py-6 text-center text-red-700">{error}</p>
        ) : event ? (
          <>
            <h1 className="text-2xl font-bold tracking-[-0.02em]">Add a tap-to-open tag</h1>
            <p className="mt-2 text-sm text-charcoal/60">
              An NFC sticker behind the &ldquo;or tap here&rdquo; mark lets guests tap their phone on
              the sign instead of scanning. It opens the same page as the QR code. Optional: the QR
              works on its own.
            </p>

            <div className="mt-6 border border-ink/10 bg-white p-4">
              <label htmlFor="event-link" className="text-sm font-semibold">
                Your event link
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="event-link"
                  ref={inputRef}
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 border border-charcoal/25 bg-canvas px-3 py-2 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={copy}
                  disabled={!link}
                  className="bg-ink px-5 py-2.5 text-sm font-medium text-canvas transition hover:bg-night disabled:opacity-50"
                >
                  {copied === 'yes' ? 'Copied' : 'Copy event link'}
                </button>
              </div>
              <p className="mt-2 text-xs text-charcoal/60" aria-live="polite">
                {copied === 'yes'
                  ? 'Copied. Paste it into the NFC app as a URL record.'
                  : copied === 'manual'
                    ? 'Your browser blocked copying. The link is selected: copy it from the box.'
                    : 'The same link your signs’ QR code opens.'}
              </p>
            </div>

            <ol className="mt-8 space-y-5">
              {steps.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-ink text-sm font-semibold text-canvas">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{step.title}</h2>
                    <p className="mt-1 text-sm text-charcoal/70">{step.body}</p>
                    {i === 0 ? <NfcOrderCard className="mt-3" /> : null}
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </main>
    </div>
  );
}

// Requires sign-in; useHostEvent limits it to the event's host or an admin.
export default withHostAuth(NfcPage, {
  purpose: 'Set up a tap-to-open tag.',
  arriving: 'returning',
});
