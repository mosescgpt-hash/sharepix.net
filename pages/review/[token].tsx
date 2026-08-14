import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Layout from '@/components/Layout';
import {
  fetchModerationReview,
  reviewFlaggedPhoto,
  type ModerationReviewView,
} from '@/lib/api';

/**
 * Decide a photo the content screener held back, from a link — no sign-in.
 *
 * The link's token is the credential, so the page shows only this one photo and
 * the function re-checks the token on every action. Neither outcome deletes
 * anything: releasing shows the photo, keeping it hidden leaves it hidden, and
 * permanent deletion stays in the host's dashboard.
 */
export default function ModerationReviewPage() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : null;
  // The email's buttons carry which action was tapped. It only pre-selects and
  // never acts on its own: mail scanners follow links, and a GET that released a
  // photo would let a scanner approve it before a human ever saw it.
  const intent =
    router.query.intent === 'release' || router.query.intent === 'dismiss'
      ? router.query.intent
      : null;

  const [review, setReview] = useState<ModerationReviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null);
  // The held photo may be explicit and the link may be opened anywhere, so it
  // starts blurred behind a deliberate tap.
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setReview(await fetchModerationReview(token));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: 'release' | 'dismiss') {
    if (!token) return;
    setWorking(true);
    setOutcome(null);
    try {
      const message = await reviewFlaggedPhoto(token, action);
      setOutcome({ text: message, ok: true });
    } catch (err) {
      setOutcome({
        text: err instanceof Error ? err.message : 'That review could not be completed.',
        ok: false,
      });
    } finally {
      setWorking(false);
    }
  }

  const expired = review ? new Date(review.expiresAt).getTime() <= Date.now() : false;
  const alreadyDecided = review ? review.status !== 'pending' : false;
  const actionable = Boolean(review) && !expired && !alreadyDecided && !outcome?.ok;

  return (
    <Layout title="Review a photo">
      <Head>
        <meta name="robots" content="noindex" />
      </Head>
      <section className="mx-auto max-w-lg py-10">
        {loading ? (
          <p className="text-center text-ink/60">Loading the photo…</p>
        ) : !review ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
            <h1 className="font-display text-2xl font-bold">This link isn’t valid</h1>
            <p className="mt-2 text-sm">
              It may have expired or already been used. You can always review held photos
              from your event dashboard.
            </p>
          </div>
        ) : (
          <>
            <h1 className="font-display text-3xl font-extrabold">Photo held for review</h1>
            <p className="mt-2 text-ink/70">
              Our screening flagged this photo{review.eventName ? ` from ${review.eventName}` : ''}, so
              guests and the slideshow can’t see it yet.
            </p>
            {review.reasons ? (
              <p className="mt-2 inline-block rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-900">
                Detected: {review.reasons}
              </p>
            ) : null}

            <div className="relative mt-6 overflow-hidden rounded-2xl border border-ink/10 bg-ink/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={review.url}
                alt="Photo awaiting review"
                className={`max-h-[60vh] w-full object-contain transition duration-200 ${
                  revealed ? '' : 'blur-2xl'
                }`}
              />
              {!revealed ? (
                <button
                  type="button"
                  onClick={() => setRevealed(true)}
                  className="absolute inset-0 grid place-items-center bg-black/30 text-white"
                >
                  <span className="rounded-full bg-black/70 px-5 py-2.5 text-sm font-medium">
                    Tap to view
                  </span>
                </button>
              ) : null}
            </div>

            {outcome ? (
              <p
                className={`mt-5 rounded-xl px-4 py-3 text-sm ${
                  outcome.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
                }`}
              >
                {outcome.text}
              </p>
            ) : null}

            {actionable && intent ? (
              <p className="mt-6 rounded-xl bg-ink/5 px-4 py-3 text-sm text-ink/70">
                You tapped{' '}
                <strong>{intent === 'release' ? 'Approve' : 'Deny'}</strong> in your email —
                confirm below. (Email apps sometimes open links on their own, so nothing
                happens until you tap here.)
              </p>
            ) : null}

            {actionable ? (
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void decide('release')}
                  className="flex-1 rounded-full bg-accent py-3 font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {working ? 'Working…' : 'Approve — show it'}
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void decide('dismiss')}
                  className="flex-1 rounded-full border border-ink/20 py-3 font-medium hover:border-red-400 hover:text-red-600 disabled:opacity-50"
                >
                  {working ? 'Working…' : 'Deny — keep it hidden'}
                </button>
              </div>
            ) : !outcome?.ok ? (
              <p className="mt-6 rounded-xl bg-ink/5 px-4 py-3 text-sm text-ink/70">
                {expired
                  ? 'This link has expired. Review the photo from your event dashboard instead.'
                  : 'This photo has already been reviewed.'}
              </p>
            ) : null}

            <p className="mt-6 text-xs text-ink/50">
              Denying keeps the photo hidden from guests. To delete it permanently, open your
              event dashboard.
            </p>
          </>
        )}
      </section>
    </Layout>
  );
}
