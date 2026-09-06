import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { unsubscribeFromEmails } from '@/lib/api';

/**
 * Where an unsubscribe link lands.
 *
 * Deliberately a button rather than an automatic opt-out on page load. Mail
 * clients and security scanners follow links in messages before a human ever
 * sees them, so a GET that unsubscribed on arrival would quietly opt people out
 * of mail they never chose to leave — and they would never know why it stopped.
 * One tap is the smallest thing that proves a person is here.
 *
 * The page is honest about scope: opting out ends optional mail and nothing
 * else. Someone who unsubscribes here still gets told before their gallery is
 * deleted, because the alternative is losing photos to a preference they set
 * about a newsletter.
 */
export default function UnsubscribePage() {
  const router = useRouter();
  const email = typeof router.query.email === 'string' ? router.query.email : '';
  const token = typeof router.query.token === 'string' ? router.query.token : '';

  const [state, setState] = useState<'ready' | 'working' | 'done' | 'failed'>('ready');
  const [message, setMessage] = useState('');

  // A link with nothing in it is a person who typed the URL, not a mistake
  // worth an error message.
  const usable = Boolean(email && token);

  useEffect(() => {
    if (state === 'done' || state === 'failed') return;
    setMessage('');
  }, [email, token, state]);

  async function handleUnsubscribe() {
    setState('working');
    const result = await unsubscribeFromEmails(email, token);
    setMessage(result.message);
    setState(result.unsubscribed ? 'done' : 'failed');
  }

  return (
    <Layout title="Email preferences">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-lg">
          <p className="spx-eyebrow">Email</p>
          <h1 className="mt-3">
            <span className="spx-display block">Stop optional</span>
            <span className="spx-display-serif block">emails.</span>
          </h1>

          {state === 'done' ? (
            <Notice tone="success" className="mt-8">
              {message}
            </Notice>
          ) : state === 'failed' ? (
            <Notice tone="warn" className="mt-8">
              {message}
            </Notice>
          ) : (
            <>
              <p className="spx-body mt-5">
                This stops surveys, product news and anything else we send because we would
                like something from you.
              </p>
              <p className="spx-body mt-3">
                You will still get messages about your own events — in particular, a warning
                before a gallery closes and its photos are deleted. Those are not marketing,
                and turning them off is not something we will do to you by accident.
              </p>

              {usable ? (
                <button
                  type="button"
                  onClick={() => void handleUnsubscribe()}
                  disabled={state === 'working'}
                  className="spx-btn-ink mt-8 w-full disabled:opacity-50"
                >
                  {state === 'working' ? 'Saving…' : 'Unsubscribe from optional emails'}
                </button>
              ) : (
                <Notice tone="info" className="mt-8">
                  Open this page from the link at the bottom of one of our emails — it carries
                  the details needed to change your preferences.
                </Notice>
              )}
            </>
          )}

          <p className="mt-8 text-sm text-charcoal/60">
            <Link href="/" className="font-medium text-pine underline">
              Back to SharePix
            </Link>
          </p>
        </div>
      </section>
    </Layout>
  );
}
