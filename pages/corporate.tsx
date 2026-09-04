import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import { CORPORATE_PLAN } from '@/lib/pricing';
import {
  getMyCorporateSubscription,
  isCorporateActive,
  openBillingPortal,
  startCorporateSubscription,
} from '@/lib/api';
import { CorporateSubscription } from '@/lib/types';

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

function CorporatePage() {
  const router = useRouter();
  const justSubscribed = router.query.subscribed === '1';

  const [sub, setSub] = useState<CorporateSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState('');
  const attemptsRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const current = await getMyCorporateSubscription();
      setSub(current);
      // Just came back from checkout but the webhook hasn't landed yet — poll.
      if (justSubscribed && !isCorporateActive(current) && attemptsRef.current < 8) {
        attemptsRef.current += 1;
        window.setTimeout(() => void load(), 2000);
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Your subscription status could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [justSubscribed]);

  useEffect(() => {
    if (!router.isReady) return;
    void load();
  }, [router.isReady, load]);

  async function handleSubscribe() {
    setWorking(true);
    setError(null);
    try {
      const url = await startCorporateSubscription(discountCode);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout could not be started.');
      setWorking(false);
    }
  }

  async function handleManage() {
    setWorking(true);
    setError(null);
    try {
      const url = await openBillingPortal();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The billing portal could not be opened.');
      setWorking(false);
    }
  }

  const active = isCorporateActive(sub);
  const renews = formatDate(sub?.currentPeriodEnd);
  const graceEnds = formatDate(sub?.downloadGraceEndsAt);

  return (
    <Layout title="Corporate plan">
      <section className="mx-auto max-w-2xl py-10">
        <p className="spx-eyebrow">
          For businesses
        </p>
        <h1 className="spx-display mt-3">
          {CORPORATE_PLAN.name} plan
        </h1>
        <p className="mt-2 text-ink/70">
          One monthly subscription for teams running multiple events — {CORPORATE_PLAN.priceLabel}.
        </p>

        {loading ? (
          <p className="mt-10 text-center text-charcoal/60">Loading your subscription…</p>
        ) : active ? (
          <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                Active
              </span>
              {sub?.cancelAtPeriodEnd ? (
                <span className="text-sm text-amber-800">Cancels at period end</span>
              ) : null}
            </div>
            <p className="mt-3 text-ink/80">
              Your Corporate subscription is active.
              {renews
                ? sub?.cancelAtPeriodEnd
                  ? ` It ends on ${renews}.`
                  : ` It renews on ${renews}.`
                : ''}
            </p>
            {sub?.cancelAtPeriodEnd && graceEnds ? (
              <p className="mt-2 text-sm text-ink/70">
                You&apos;ll be able to download your events until {graceEnds} (30 days after
                your last paid month).
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void handleManage()}
              disabled={working}
              className="mt-5 rounded-full bg-ink px-6 py-3 font-medium text-white hover:bg-night disabled:opacity-50"
            >
              {working ? 'Opening…' : 'Manage or cancel subscription'}
            </button>
          </div>
        ) : (
          <div className="spx-card mt-8 p-7">
            {justSubscribed ? (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Thanks! We&apos;re finalizing your subscription — this can take a few seconds.
                If it doesn&apos;t appear shortly, refresh the page.
              </p>
            ) : null}
            <p className="font-sans text-2xl font-bold tracking-[-0.02em]">{CORPORATE_PLAN.priceLabel}</p>
            <ul className="mt-4 space-y-2 text-sm text-ink/80">
              {CORPORATE_PLAN.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span className="text-pine">✓</span>
                  {feature}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <label htmlFor="corp-discount" className="text-sm font-medium">
                Discount code <span className="text-charcoal/50">(optional)</span>
              </label>
              <input
                id="corp-discount"
                type="text"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                placeholder="Enter code"
                autoComplete="off"
                className="spx-input mt-2 uppercase"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSubscribe()}
              disabled={working}
              className="spx-btn-ink mt-5 w-full disabled:opacity-50"
            >
              {working ? 'Sending you to checkout…' : `Subscribe · ${CORPORATE_PLAN.priceLabel}`}
            </button>
            <p className="mt-3 text-center text-xs text-charcoal/60">
              Secure recurring billing on Stripe. Cancel anytime from your account.
            </p>
          </div>
        )}

        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
      </section>
    </Layout>
  );
}

// Hosts sign in before subscribing so the plan attaches to their account.
export default withAuthenticator(CorporatePage);
