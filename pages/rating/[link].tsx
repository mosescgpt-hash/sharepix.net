import { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { submitEventFeedback } from '@/lib/api';
import { CONSENT_TEXT, RATING_MAX, RATING_MIN } from '@/lib/customerRating';
import { SUPPORT_EMAIL } from '@/lib/businessInfo';

/**
 * Where a rating request lands.
 *
 * One tap, then one of two follow-ups, and which one is decided by the server
 * rather than here: a page that branched on its own copy of the rule could
 * drift from the rule, and the branch decides what a person is asked to give
 * permission for.
 *
 * ## What this page does not do
 *
 * It never asks anyone to leave a review on Google, an app store or anywhere
 * else SharePix does not own. Asking only satisfied customers to do that is
 * review gating — the score becomes a filter on who is invited to speak, and
 * the public record it produces is skewed on purpose. Asking satisfied
 * customers for a testimonial on our own site is a different thing: it is
 * advertising copy, and nobody has ever believed a company's own page carries a
 * representative sample of opinion.
 *
 * ## The low-rating branch
 *
 * Support, not silence. There is no step here that discourages a complaint,
 * makes it harder to send, or asks the person to reconsider before sending it.
 * What they write is stored and shown to admins exactly like praise.
 */
export default function RatingPage() {
  const router = useRouter();
  const link = typeof router.query.link === 'string' ? router.query.link : '';

  const [rating, setRating] = useState<number | null>(null);
  const [branch, setBranch] = useState<'testimonial' | 'support' | null>(null);
  const [eventName, setEventName] = useState('');
  const [text, setText] = useState('');
  // Never pre-checked. A grant that was on by default is not a grant.
  const [permission, setPermission] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [state, setState] = useState<'ready' | 'working' | 'done' | 'failed'>('ready');
  const [message, setMessage] = useState('');

  async function score(value: number) {
    setRating(value);
    setState('working');
    const result = await submitEventFeedback({ link, rating: value });
    if (!result.recorded) {
      setMessage(result.message);
      setState('failed');
      return;
    }
    setEventName(result.eventName);
    setMessage(result.message);
    // 'done' comes back when this event has already been answered — a reload,
    // or a second click of the same link. Say thank you rather than ask again.
    if (result.branch === 'testimonial' || result.branch === 'support') {
      setBranch(result.branch);
      setState('ready');
    } else {
      setState('done');
    }
  }

  async function submitWords() {
    setState('working');
    const result = await submitEventFeedback(
      branch === 'testimonial'
        ? {
            link,
            testimonialText: text,
            marketingPermission: permission,
            displayMode: permission && displayName.trim() ? 'first_name' : 'anonymous',
            displayName: permission ? displayName : undefined,
          }
        : { link, privateFeedback: text },
    );
    setMessage(result.message);
    setState(result.recorded ? 'done' : 'failed');
  }

  const scores = Array.from(
    { length: RATING_MAX - RATING_MIN + 1 },
    (_, index) => RATING_MIN + index,
  );

  return (
    <Layout title="How did it go?">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-lg">
          <p className="spx-eyebrow">Your event</p>

          {state === 'done' ? (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">Thank you —</span>
                <span className="spx-display-serif block">that&rsquo;s recorded.</span>
              </h1>
              <Notice tone="success" className="mt-8">
                {message}
              </Notice>
              {branch === 'support' ? (
                <p className="spx-body mt-6">
                  If you would rather talk to a person about it, write to{' '}
                  <a className="font-medium text-pine underline" href={`mailto:${SUPPORT_EMAIL}`}>
                    {SUPPORT_EMAIL}
                  </a>
                  .
                </p>
              ) : null}
            </>
          ) : state === 'failed' ? (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">That link</span>
                <span className="spx-display-serif block">didn&rsquo;t work.</span>
              </h1>
              <Notice tone="warn" className="mt-8">
                {message}
              </Notice>
            </>
          ) : branch === null ? (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">How did</span>
                <span className="spx-display-serif block">it go?</span>
              </h1>
              <p className="spx-body mt-5">
                One tap. It is the main way we find out whether SharePix did its job.
              </p>
              <div className="mt-8 flex gap-3" role="group" aria-label="Rate your event">
                {scores.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={state === 'working'}
                    onClick={() => void score(value)}
                    aria-label={`${value} out of ${RATING_MAX}`}
                    aria-pressed={rating === value}
                    className="flex h-14 w-14 items-center justify-center rounded-full border border-charcoal/20 text-lg font-semibold transition hover:border-charcoal hover:bg-charcoal hover:text-canvas disabled:opacity-50"
                  >
                    {value}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-sm text-charcoal/60">
                {RATING_MIN} is poor, {RATING_MAX} is excellent.
              </p>
            </>
          ) : branch === 'testimonial' ? (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">Glad it worked</span>
                <span className="spx-display-serif block">for you.</span>
              </h1>
              <p className="spx-body mt-5">
                Would you say a little more about {eventName || 'your event'}? What did you
                like most, and would you tell someone planning an event about it?
              </p>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                maxLength={1200}
                className="spx-input mt-6 w-full"
                placeholder="A sentence or two is plenty."
              />
              <label className="mt-5 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={permission}
                  onChange={(event) => setPermission(event.target.checked)}
                  className="mt-1"
                />
                <span className="spx-body">{CONSENT_TEXT}</span>
              </label>
              {permission ? (
                <label className="mt-4 block">
                  <span className="text-sm text-charcoal/60">
                    First name to show with it, if you want one. Leave it blank to stay
                    anonymous.
                  </span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    maxLength={80}
                    className="spx-input mt-2 w-full"
                  />
                </label>
              ) : (
                <p className="mt-3 text-sm text-charcoal/60">
                  Leave that unticked and your words stay with us — we will read them and
                  publish nothing.
                </p>
              )}
              <button
                type="button"
                disabled={state === 'working' || !text.trim()}
                onClick={() => void submitWords()}
                className="spx-btn-ink mt-8 disabled:opacity-50"
              >
                {state === 'working' ? 'Sending…' : 'Send it'}
              </button>
            </>
          ) : (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">What could we</span>
                <span className="spx-display-serif block">have done better?</span>
              </h1>
              <p className="spx-body mt-5">
                Tell us what went wrong with {eventName || 'your event'}. It goes to a
                person, not a form, and it is the most useful thing we get.
              </p>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
                maxLength={4000}
                className="spx-input mt-6 w-full"
                placeholder="As much or as little as you like."
              />
              <button
                type="button"
                disabled={state === 'working' || !text.trim()}
                onClick={() => void submitWords()}
                className="spx-btn-ink mt-8 disabled:opacity-50"
              >
                {state === 'working' ? 'Sending…' : 'Send it'}
              </button>
              <p className="spx-body mt-6">
                Or write to{' '}
                <a className="font-medium text-pine underline" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>{' '}
                if you would rather talk to someone.
              </p>
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}
