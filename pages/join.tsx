import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { findEventByCode } from '@/lib/api';
import {
  EVENT_CODE_MAX_LENGTH,
  EVENT_CODE_NOT_FOUND,
  isEventCodeShaped,
  normalizeEventCode,
} from '@/lib/eventCodeFormat';

/**
 * For a guest who has the code but not the QR link.
 *
 * The QR code is still the way in and this page says so: it is the fallback
 * for a phone that will not scan, a code read out from the front of the room,
 * or a card that went through the wash. Help used to tell guests to type their
 * code on the homepage, which had no field to type it into — this is the page
 * that instruction was describing.
 *
 * One answer for "that is not a code" and "no event has that code". A scanner
 * would learn which guesses were closer from any difference, and an honest
 * guest has the same job either way: look at the card again.
 */
export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'looking' | 'missing'>('idle');

  const tidy = normalizeEventCode(code);
  const ready = isEventCodeShaped(tidy);

  async function submit() {
    if (!ready) {
      setState('missing');
      return;
    }
    setState('looking');
    const eventId = await findEventByCode(tidy).catch(() => null);
    if (!eventId) {
      setState('missing');
      return;
    }
    await router.push(`/event/${eventId}/upload`);
  }

  return (
    <Layout title="Find your event">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-md">
          <p className="spx-eyebrow">Find your event</p>
          <h1 className="mt-3">
            <span className="spx-display block">Got a code</span>
            <span className="spx-display-serif block">but no QR?</span>
          </h1>
          <p className="spx-body mt-5">
            Scanning the QR code is quicker. If you cannot, type the code from the card or
            sign below — it is three words joined by dashes.
          </p>

          <form
            className="mt-8"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block">
              <span className="spx-body font-medium">Event code</span>
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (state === 'missing') setState('idle');
                }}
                placeholder="brave-copper-lantern"
                maxLength={EVENT_CODE_MAX_LENGTH + 8}
                // Codes are lowercase words; phones capitalise and autocorrect
                // by default, and both turn a valid code into a rejected one.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                className="spx-input mt-2 w-full"
              />
            </label>

            {state === 'missing' ? (
              <Notice tone="warn" className="mt-4">
                {EVENT_CODE_NOT_FOUND}
              </Notice>
            ) : null}

            <button
              type="submit"
              disabled={!ready || state === 'looking'}
              className="spx-btn-ink mt-6 disabled:opacity-50"
            >
              {state === 'looking' ? 'Looking…' : 'Go to the event'}
            </button>
          </form>

          <p className="mt-8 text-sm text-charcoal/60">
            Hosting rather than attending?{' '}
            <Link href="/my-events" className="text-pine underline">
              Your events
            </Link>
          </p>
        </div>
      </section>
    </Layout>
  );
}
