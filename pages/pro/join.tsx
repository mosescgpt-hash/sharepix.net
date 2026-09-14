import { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { connectPhotographer } from '@/lib/api';
import { formatPairingCode, normalizePairingCode, PAIRING_CODE_LENGTH } from '@/lib/photographerAccess';

/**
 * Where a photographer redeems the code a host gave them.
 *
 * The code is a bearer credential, so redeeming it is the acceptance — there
 * is no second confirmation step, because the host handing it over and the
 * photographer typing it in are already two deliberate acts by two people.
 */
export default function ProJoinPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const [message, setMessage] = useState('');

  const tidy = normalizePairingCode(code);
  const ready = tidy.length === PAIRING_CODE_LENGTH;

  async function submit() {
    setState('working');
    setMessage('');
    try {
      const result = await connectPhotographer({ action: 'pair', code: tidy });
      if (result.eventId) {
        await router.push(`/pro/events/${result.eventId}/review`);
        return;
      }
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That code is not valid.');
    } finally {
      setState('idle');
    }
  }

  return (
    <Layout title="Join an event">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-md">
          <p className="spx-eyebrow">SharePix Pro</p>
          <h1 className="mt-3">
            <span className="spx-display block">Join an event</span>
            <span className="spx-display-serif block">you are shooting.</span>
          </h1>
          <p className="spx-body mt-5">
            The host gives you a code from their dashboard. It works once and expires
            quickly, so ask for it when you are ready to set up.
          </p>

          <form
            className="mt-8"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label className="block">
              <span className="spx-body font-medium">Pairing code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCD-EFGH"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="spx-input mt-2 w-full font-mono tracking-widest"
              />
            </label>
            {tidy && !ready ? (
              <p className="mt-2 text-xs text-charcoal/55">
                {formatPairingCode(tidy)} — {PAIRING_CODE_LENGTH - tidy.length} more to go.
              </p>
            ) : null}
            {message ? (
              <Notice tone="warn" className="mt-4">
                {message}
              </Notice>
            ) : null}
            <button
              type="submit"
              disabled={!ready || state === 'working'}
              className="spx-btn-ink mt-6 disabled:opacity-50"
            >
              {state === 'working' ? 'Joining…' : 'Join the event'}
            </button>
          </form>
        </div>
      </section>
    </Layout>
  );
}
