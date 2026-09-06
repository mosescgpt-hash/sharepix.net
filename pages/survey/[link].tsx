import { useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import { completeResearchSurvey } from '@/lib/api';
import { INCENTIVE_AMOUNT_USD } from '@/lib/researchIncentive';

/**
 * Where a research survey invitation lands.
 *
 * The survey itself is somewhere else — a form provider, configured per
 * environment — and this page is the part we own on either side of it: it
 * explains the deal, sends people out to the form, and takes their word for it
 * when they come back.
 *
 * Taking their word is deliberate. A person buys and sends every gift card by
 * hand, and checks the actual survey response before doing it, so a claimed
 * completion is a queue item rather than a payment. Building a tamper-proof
 * completion signal would mean either hosting the survey ourselves or trusting
 * a form provider's redirect — both more work than the human check that is
 * already happening, and neither more reliable than it.
 *
 * The promise on this page is the one thing that must not slip: the gift card
 * does not depend on what they say. If it did, the research would be worthless
 * and we would be paying for agreement.
 */
export default function SurveyPage() {
  const router = useRouter();
  const link = typeof router.query.link === 'string' ? router.query.link : '';
  const surveyUrl = process.env.NEXT_PUBLIC_RESEARCH_SURVEY_URL ?? '';

  const [state, setState] = useState<'ready' | 'working' | 'done' | 'failed'>('ready');
  const [message, setMessage] = useState('');

  async function handleComplete() {
    setState('working');
    const result = await completeResearchSurvey(link);
    setMessage(result.message);
    setState(result.recorded ? 'done' : 'failed');
  }

  return (
    <Layout title="Research survey">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-lg">
          <p className="spx-eyebrow">Research</p>

          {state === 'done' ? (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">Thank you —</span>
                <span className="spx-display-serif block">your feedback is in.</span>
              </h1>
              <Notice tone="success" className="mt-8">
                {message}
              </Notice>
            </>
          ) : (
            <>
              <h1 className="mt-3">
                <span className="spx-display block">Tell us how</span>
                <span className="spx-display-serif block">it actually went.</span>
              </h1>
              <p className="spx-body mt-5">
                About ten minutes, and there&rsquo;s a ${INCENTIVE_AMOUNT_USD} Amazon gift card
                for finishing it.
              </p>
              <p className="spx-body mt-3">
                <strong className="font-semibold text-charcoal">
                  Whatever you tell us earns the same ${INCENTIVE_AMOUNT_USD}.
                </strong>{' '}
                Criticism is worth more to us than praise, and the reward does not depend on a
                rating, a recommendation, or letting us use your photos. If it did, we would be
                paying for agreement rather than learning anything.
              </p>

              {state === 'failed' ? (
                <Notice tone="warn" className="mt-8">
                  {message}
                </Notice>
              ) : null}

              {surveyUrl ? (
                <a
                  href={surveyUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="spx-btn-ink mt-8 block w-full text-center"
                >
                  Open the survey
                </a>
              ) : (
                <Notice tone="info" className="mt-8">
                  The survey is not open yet. Please keep this email — we will be in touch when
                  it is ready.
                </Notice>
              )}

              {surveyUrl && link ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleComplete()}
                    disabled={state === 'working'}
                    className="spx-btn-outline mt-3 w-full disabled:opacity-50"
                  >
                    {state === 'working' ? 'Saving…' : 'I have finished the survey'}
                  </button>
                  <p className="mt-3 text-xs text-charcoal/55">
                    Come back and tap this once you have submitted your answers, so we know to
                    send your gift card.
                  </p>
                </>
              ) : null}
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
