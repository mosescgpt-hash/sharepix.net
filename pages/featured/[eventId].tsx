import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import {
  fetchEvent,
  fetchEventPhotos,
  fetchMyMarketingSubmission,
  getCurrentUserInfo,
  submitMarketingOffer,
} from '@/lib/api';
import {
  CONSENT_SUMMARY,
  MARKETING_TIERS,
  RIGHTS_QUESTIONS,
  refundValueUsd,
  tierByKey,
} from '@/lib/marketingRelease';
import { getTier } from '@/lib/pricing';
import type { DisplayPhoto, QREvent } from '@/lib/types';

/**
 * Where a host offers photos from their event for marketing.
 *
 * ## What this page is careful about
 *
 * A customer's photos are theirs. Nothing here selects anything on their
 * behalf, nothing is pre-ticked, and the gallery shown is their own event's —
 * SharePix does not reach into a private gallery and propose a set. They pick,
 * and what they pick is all that is ever offered.
 *
 * The permission is described in the same words everywhere it appears
 * (CONSENT_SUMMARY), and the confirmations are theirs to make rather than
 * implied by pressing a button: a release nobody read is not a release.
 *
 * Choosing is not granting, either. This produces an offer; a person reviews it
 * and decides which specific photos may be used, and the page says so rather
 * than letting somebody believe their photos are already published.
 */
export default function FeaturedEventPage() {
  const router = useRouter();
  const eventId = typeof router.query.eventId === 'string' ? router.query.eventId : '';

  const [event, setEvent] = useState<QREvent | null>(null);
  const [photos, setPhotos] = useState<DisplayPhoto[]>([]);
  const [alreadyOffered, setAlreadyOffered] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'denied' | 'ready' | 'sending' | 'done'>(
    'loading',
  );
  const [message, setMessage] = useState('');

  const [tierKey, setTierKey] = useState(MARKETING_TIERS[0].key);
  const [chosen, setChosen] = useState<string[]>([]);
  const [testimonial, setTestimonial] = useState('');
  // Never pre-ticked. A confirmation that was on by default confirms nothing.
  const [confirmed, setConfirmed] = useState(false);

  const tier = tierByKey(tierKey) ?? MARKETING_TIERS[0];
  const eventPriceUsd = useMemo(() => getTier(event?.tier ?? '')?.price ?? 0, [event]);
  const reward = refundValueUsd(tier, eventPriceUsd);

  const load = useCallback(async () => {
    if (!eventId) return;
    const user = await getCurrentUserInfo();
    const found = await fetchEvent(eventId).catch(() => null);
    // One answer for "no such event" and "not yours".
    if (!user || !found || !found.owner?.includes(user.userId)) {
      setPhase('denied');
      return;
    }
    setEvent(found);

    const existing = await fetchMyMarketingSubmission(eventId).catch(() => null);
    if (existing) {
      setAlreadyOffered(true);
      setPhase('done');
      setMessage('You have already offered photos from this event. We will be in touch.');
      return;
    }

    setPhotos(await fetchEventPhotos(eventId, { useThumbs: true }).catch(() => []));
    setPhase('ready');
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(photoId: string) {
    setChosen((current) =>
      current.includes(photoId)
        ? current.filter((id) => id !== photoId)
        : current.length >= tier.maxAssets
          ? current
          : [...current, photoId],
    );
  }

  async function submit() {
    setPhase('sending');
    const result = await submitMarketingOffer({
      eventId,
      tierKey,
      photoIds: chosen,
      testimonial: testimonial.trim() || undefined,
      rightsConfirmed: confirmed,
    });
    setMessage(result.message);
    setPhase(result.recorded ? 'done' : 'ready');
  }

  if (phase === 'loading') {
    return (
      <Layout title="Featured Events">
        <section className="spx-section-canvas">
          <p className="spx-body" role="status">
            Loading your event…
          </p>
        </section>
      </Layout>
    );
  }

  if (phase === 'denied') {
    return (
      <Layout title="Featured Events">
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-xl">
            <h1 className="mt-3">
              <span className="spx-display block">We could not</span>
              <span className="spx-display-serif block">find that event.</span>
            </h1>
            <p className="spx-body mt-5">
              You can only offer photos from an event you host.{' '}
              <Link href="/my-events" className="font-medium text-pine underline">
                Your events
              </Link>
            </p>
          </div>
        </section>
      </Layout>
    );
  }

  if (phase === 'done') {
    return (
      <Layout title="Thank you">
        <section className="spx-section-canvas">
          <div className="mx-auto w-full max-w-xl">
            <h1 className="mt-3">
              <span className="spx-display block">Thank you.</span>
              <span className="spx-display-serif block">
                {alreadyOffered ? 'We already have these.' : 'We will take a look.'}
              </span>
            </h1>
            <Notice tone="success" className="mt-8">
              {message}
            </Notice>
            <p className="spx-body mt-6">
              Nothing is published unless we come back to you about it, and you can change
              your mind at any time.
            </p>
          </div>
        </section>
      </Layout>
    );
  }

  const enough = chosen.length >= tier.minAssets;

  return (
    <Layout title="Featured Events">
      <section className="spx-section-canvas">
        <div className="mx-auto w-full max-w-3xl">
          <p className="spx-eyebrow">Featured Events</p>
          <h1 className="mt-3">
            <span className="spx-display block">Show future hosts</span>
            <span className="spx-display-serif block">what SharePix can do.</span>
          </h1>
          <p className="spx-body mt-5">
            If you loved {event?.name ?? 'your event'}, you can offer us a few photos to
            show people what SharePix is actually for. {CONSENT_SUMMARY}
          </p>

          {message ? (
            <Notice tone="warn" className="mt-6">
              {message}
            </Notice>
          ) : null}

          <fieldset className="mt-10">
            <legend className="spx-body font-medium">Which would you like to do?</legend>
            <div className="mt-4 space-y-2">
              {MARKETING_TIERS.map((option) => {
                const value = refundValueUsd(option, eventPriceUsd);
                return (
                  <label
                    key={option.key}
                    className={`flex cursor-pointer items-start gap-3 border p-4 transition ${
                      tierKey === option.key
                        ? 'border-ink bg-sage/40'
                        : 'border-charcoal/20 hover:border-charcoal/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="tier"
                      className="mt-1"
                      checked={tierKey === option.key}
                      onChange={() => {
                        setTierKey(option.key);
                        setChosen((current) => current.slice(0, option.maxAssets));
                      }}
                    />
                    <span>
                      <span className="spx-body font-medium">{option.label}</span>
                      <span className="block text-sm text-charcoal/70">{option.provides}</span>
                      {/* Said before they choose, not after. What is on offer
                          should never be a surprise at the end. */}
                      <span className="block text-sm text-pine">
                        {value > 0
                          ? `${option.refundPercent}% back on this event — $${value}`
                          : 'No refund on a free event, but we would still love the photos'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-10">
            <h2 className="spx-body font-medium">
              Choose {tier.minAssets} to {tier.maxAssets} photos
            </h2>
            <p className="mt-1 text-sm text-charcoal/60">
              {chosen.length} chosen. Only these are offered — the rest of your gallery
              stays private.
            </p>
            {photos.length === 0 ? (
              <p className="mt-4 border border-dashed border-charcoal/25 p-6 text-center text-sm text-charcoal/60">
                There are no photos on this event yet.
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photos.map((photo) => {
                  const picked = chosen.includes(photo.id);
                  return (
                    <li key={photo.id}>
                      <label
                        className={`block cursor-pointer border-2 transition ${
                          picked ? 'border-ink' : 'border-transparent hover:border-charcoal/30'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={picked}
                          onChange={() => toggle(photo.id)}
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url ?? photo.fallbackUrl ?? ''}
                          alt=""
                          className="aspect-square w-full object-cover"
                        />
                        <span className="sr-only">
                          {picked ? 'Chosen for marketing' : 'Choose this photo for marketing'}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {tier.wantsTestimonial ? (
            <label className="mt-10 block">
              <span className="spx-body font-medium">A few sentences about your event</span>
              <span className="mt-1 block text-sm text-charcoal/60">
                What it was, and how SharePix went. We may quote this alongside the photos.
              </span>
              <textarea
                value={testimonial}
                onChange={(e) => setTestimonial(e.target.value)}
                rows={4}
                maxLength={2000}
                className="spx-input mt-3 w-full"
              />
            </label>
          ) : null}

          <div className="mt-10 border-t border-charcoal/15 pt-6">
            <p className="spx-body font-medium">Before you send these</p>
            <ul className="mt-3 space-y-2">
              {RIGHTS_QUESTIONS.map((question) => (
                <li key={question} className="spx-body text-sm">
                  · {question}
                </li>
              ))}
            </ul>
            <label className="mt-5 flex items-start gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span className="spx-body">
                All of the above is true, and I am happy for SharePix to use the photos I
                chose to show what the product does.
              </span>
            </label>

            <button
              type="button"
              disabled={!enough || !confirmed || phase === 'sending'}
              onClick={() => void submit()}
              className="spx-btn-ink mt-8 disabled:opacity-50"
            >
              {phase === 'sending' ? 'Sending…' : 'Offer these photos'}
            </button>
            {!enough ? (
              <p className="mt-3 text-sm text-charcoal/60">
                Choose at least {tier.minAssets} photos to continue.
              </p>
            ) : null}
            <p className="mt-4 text-sm text-charcoal/60">
              We will tell you which ones we can use. Nothing is published unless we do, and
              you can withdraw at any time by replying to that email.
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
