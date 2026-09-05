import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import EventQRCode from '@/components/EventQRCode';
import { CORPORATE_PLAN, PRICING_TIERS, applyDiscount, getTier } from '@/lib/pricing';
import {
  createNewEvent,
  getMyCorporateSubscription,
  isCorporateActive,
  startCheckout,
  validateDiscountCode,
} from '@/lib/api';
import { QREvent } from '@/lib/types';

function CreateEventPage() {
  const router = useRouter();
  const initialTier = typeof router.query.tier === 'string' ? router.query.tier : 'standard';

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [city, setCity] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [tierId, setTierId] = useState(getTier(initialTier) ? initialTier : 'standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEvent, setCreatedEvent] = useState<QREvent | null>(null);
  const [corporateActive, setCorporateActive] = useState(false);
  const [pilotCode, setPilotCode] = useState('');
  const [pilotCodeStatus, setPilotCodeStatus] = useState<
    'idle' | 'checking' | 'valid' | 'invalid'
  >('idle');
  const [pilotCodeMessage, setPilotCodeMessage] = useState<string | null>(null);
  // How much a valid code takes off (100 = free). Null until a code validates.
  // What a validated code takes off. Null until a code validates.
  const [pilotDiscount, setPilotDiscount] = useState<{
    discountType: string;
    percentOff: number;
    amountOffCents: number;
  } | null>(null);

  function clearPilotCode() {
    setPilotCodeStatus('idle');
    setPilotCodeMessage(null);
    setPilotDiscount(null);
  }

  // Active Corporate subscribers can create events included in their plan (free).
  // Default them to the corporate option unless they arrived with a specific plan.
  useEffect(() => {
    getMyCorporateSubscription()
      .then((sub) => {
        const active = isCorporateActive(sub);
        setCorporateActive(active);
        if (active && typeof router.query.tier !== 'string') setTierId('corporate');
      })
      .catch(() => setCorporateActive(false));
  }, [router.query.tier]);

  async function applyPilotCode() {
    if (!pilotCode.trim()) {
      setPilotCodeStatus('invalid');
      setPilotCodeMessage('Enter your pilot code first.');
      return;
    }

    setPilotCodeStatus('checking');
    setPilotCodeMessage(null);

    try {
      const result = await validateDiscountCode(pilotCode, tierId);

      if (!result.valid) {
        setPilotCodeStatus('invalid');
        setPilotCodeMessage(
          result.message ?? 'That pilot code is not valid. Check the code and try again.',
        );
        return;
      }

      // A legacy tier-scoped code carries the plan it unlocks — switch to it. A
      // new 'all' code applies to whatever plan is already selected.
      const unlockedTier =
        result.appliesToTier &&
        result.appliesToTier !== 'all' &&
        getTier(result.appliesToTier)
          ? result.appliesToTier
          : tierId;
      setTierId(unlockedTier);

      const discount = {
        discountType: result.discountType === 'amount' ? 'amount' : 'percent',
        percentOff: result.percentOff == null ? 100 : result.percentOff,
        amountOffCents: result.amountOffCents ?? 0,
      };
      setPilotDiscount(discount);
      setPilotCodeStatus('valid');

      const planName = getTier(unlockedTier)?.name ?? 'selected';
      const priceNow = applyDiscount(getTier(unlockedTier)?.price ?? 0, discount);
      const label =
        discount.discountType === 'amount'
          ? `$${(discount.amountOffCents / 100).toFixed(2)} off`
          : `${discount.percentOff}% off`;
      setPilotCodeMessage(
        priceNow <= 0
          ? `Free event — ${label} covers the ${planName} plan.`
          : `${label} applied to the ${planName} plan.`,
      );
    } catch {
      setPilotCodeStatus('invalid');
      setPilotCodeMessage('We could not check that code. Please try again.');
    }
  }

  // A code that covers the whole price comps the event (created free, no
  // Stripe). A partial code still goes through Stripe with the discount applied
  // there. This works the same whether the code is a percentage or an amount.
  const basePrice = getTier(tierId)?.price ?? 0;
  const discountedPrice = pilotDiscount ? applyDiscount(basePrice, pilotDiscount) : basePrice;
  const isComped = pilotCodeStatus === 'valid' && discountedPrice <= 0;
  const isDiscounted =
    pilotCodeStatus === 'valid' && pilotDiscount != null && discountedPrice > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Give your event a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // One call, and the server decides whether the event starts active. The
      // subscription check, the code's validity, and what it's worth are all
      // re-derived there from its own tables — the prices and the corporate
      // banner on this page are a preview of that decision, never the input to
      // it. The code goes along in the same request, so a code is only ever
      // spent on an event that actually got created.
      const event = await createNewEvent({
        name: name.trim(),
        date,
        city,
        state: stateRegion,
        tier: tierId,
        discountCode: pilotCodeStatus === 'valid' ? pilotCode : undefined,
      });

      // Active already: covered by a Corporate subscription, or comped outright.
      if (event.paid !== false) {
        setCreatedEvent(event);
        return;
      }

      // Pending: it exists but accepts no uploads until the Stripe webhook flips
      // `paid`. A partial discount code rides along and is applied at Stripe.
      const url = await startCheckout(tierId, event.id, isDiscounted ? pilotCode : undefined);
      window.location.assign(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong creating the event.';
      setError(message);
      setBusy(false);
    }
  }

  if (createdEvent) {
    const tier = getTier(createdEvent.tier);
    return (
      <Layout title="Event created" width="bleed">
        <section className="spx-section-ink py-10 sm:py-14">
          <div className="mx-auto w-full max-w-lg">
            <p className="spx-eyebrow">Event code {createdEvent.eventCode}</p>
            <h1 className="mt-3">
              <span className="spx-display block">{createdEvent.name}</span>
              <span className="spx-display-serif block">is live.</span>
            </h1>
          </div>
        </section>
        <section className="spx-section-canvas py-10 sm:py-14">
          <div className="mx-auto w-full max-w-lg">
          <div>
            <EventQRCode
              eventId={createdEvent.id}
              eventName={createdEvent.name}
              allowCustomization={tier?.id !== 'starter'}
            />
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push(`/event/${createdEvent.id}/admin`)}
              className="spx-btn-ink flex-1"
            >
              Open admin dashboard
            </button>
            <button
              type="button"
              onClick={() => router.push(`/event/${createdEvent.id}`)}
              className="spx-btn-outline flex-1"
            >
              View gallery
            </button>
          </div>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout title="Create an event" width="bleed">
      <section className="spx-section-ink py-10 sm:py-14">
        <div className="mx-auto w-full max-w-lg">
          <p className="spx-eyebrow">A minute of typing</p>
          <h1 className="mt-3">
            <span className="spx-display block">Create your event.</span>
            <span className="spx-display-serif block">The code comes next.</span>
          </h1>
          <p className="spx-body mt-4">
            Name it and choose a plan. Pay securely on Stripe — or apply a pilot code — and your
            QR code is ready right after.
          </p>
        </div>
      </section>

      <section className="spx-section-canvas py-10 sm:py-14">
        <div className="mx-auto w-full max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="event-name" className="block text-sm font-medium">
              Event name
            </label>
            <input
              id="event-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sam & Riley's Wedding"
              maxLength={80}
              className="spx-input mt-2"
            />
          </div>

          <div>
            <label htmlFor="event-date" className="block text-sm font-medium">
              Event date <span className="text-charcoal/50">(optional)</span>
            </label>
            <input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="spx-input mt-2"
            />
          </div>

          <div>
            <span className="block text-sm font-medium">
              Where is it? <span className="text-charcoal/50">(optional)</span>
            </span>
            <div className="mt-1 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <input
                id="event-city"
                type="text"
                value={city}
                maxLength={60}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                aria-label="City"
                className="spx-input"
              />
              <input
                id="event-state"
                type="text"
                value={stateRegion}
                maxLength={40}
                onChange={(e) => setStateRegion(e.target.value)}
                placeholder="State"
                aria-label="State"
                className="spx-input"
              />
            </div>
            <p className="mt-1.5 text-xs text-charcoal/55">
              Shown with the event, so photos stay tied to the place years later. City and
              state only — we never store a street address, and photo location data is
              always removed on upload.
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-charcoal">Plan</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {PRICING_TIERS.map((tier) => (
                <label
                  key={tier.id}
                  className={`cursor-pointer border p-4 text-sm transition ${
                    tierId === tier.id
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-charcoal/15 bg-paper hover:border-charcoal/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={tier.id}
                    checked={tierId === tier.id}
                    onChange={() => {
                      setTierId(tier.id);
                      // Re-validate the discount against the newly chosen plan.
                      if (pilotCodeStatus !== 'idle') clearPilotCode();
                    }}
                    className="sr-only"
                  />
                  <span className="block font-sans font-semibold">{tier.name}</span>
                  <span className="block text-charcoal/70">${tier.price} / event</span>
                  <span className="block text-xs text-charcoal/55">
                    {tier.photoLimit ? `${tier.photoLimit.toLocaleString()} photos` : 'Unlimited photos'} ·{' '}
                    {tier.accessLabel}
                  </span>
                </label>
              ))}
            </div>

            {corporateActive ? (
              <label
                className={`mt-3 flex cursor-pointer items-start gap-3 border p-4 text-sm transition ${
                  tierId === 'corporate'
                    ? 'border-ink bg-ink text-canvas'
                    : 'border-charcoal/15 bg-paper hover:border-charcoal/40'
                }`}
              >
                <input
                  type="radio"
                  name="tier"
                  value="corporate"
                  checked={tierId === 'corporate'}
                  onChange={() => {
                    setTierId('corporate');
                    if (pilotCodeStatus !== 'idle') clearPilotCode();
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="block font-sans font-semibold">
                    {CORPORATE_PLAN.name} event · included
                  </span>
                  <span className="block text-pine">
                    Free with your subscription — no per-event charge
                  </span>
                  <span className="block text-xs text-charcoal/55">
                    Unlimited photos · 1-year host access
                  </span>
                </span>
              </label>
            ) : null}
          </fieldset>

          <div className="spx-card p-5">
            <label htmlFor="pilot-code" className="block font-sans font-semibold text-charcoal">
              Have a discount code?
            </label>
            <p className="mt-1 text-sm text-charcoal/60">
              Apply it to take a percentage off — or make your event free.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                id="pilot-code"
                type="text"
                value={pilotCode}
                onChange={(e) => {
                  setPilotCode(e.target.value);
                  if (pilotCodeStatus !== 'idle') clearPilotCode();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void applyPilotCode();
                  }
                }}
                placeholder="Enter pilot code"
                autoComplete="off"
                className="spx-input min-w-0 flex-1 uppercase"
              />
              <button
                type="button"
                onClick={() => void applyPilotCode()}
                disabled={pilotCodeStatus === 'checking'}
                className="border border-charcoal/25 px-5 py-3 font-medium text-charcoal transition hover:border-charcoal/60 disabled:opacity-50"
              >
                {pilotCodeStatus === 'checking' ? 'Checking…' : 'Apply code'}
              </button>
            </div>
            {pilotCodeMessage ? (
              <p
                aria-live="polite"
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  pilotCodeStatus === 'valid'
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-red-50 text-red-700'
                }`}
              >
                {pilotCodeMessage}
              </p>
            ) : null}
            {pilotCodeStatus === 'valid' ? (
              <p className="mt-3 text-sm font-medium text-ink">
                {getTier(tierId)?.name}:{' '}
                <span className="text-charcoal/50 line-through">${basePrice}</span>{' '}
                <span className="text-pine">
                  {isComped ? '$0' : `$${discountedPrice}`}
                </span>
              </p>
            ) : null}
          </div>

          {error ? (
            <Notice tone="error">{error}</Notice>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="spx-btn-ink w-full disabled:opacity-50"
          >
            {busy
              ? tierId === 'corporate' || isComped
                ? 'Creating…'
                : 'Sending you to checkout…'
              : tierId === 'corporate'
                ? 'Create corporate event & get QR code'
                : isComped
                  ? 'Create free event & get QR code'
                  : `Continue to payment · $${isDiscounted ? discountedPrice : basePrice}`}
          </button>
          {tierId !== 'corporate' && !isComped ? (
            <p className="text-center text-xs text-charcoal/55">
              You&apos;ll enter payment on Stripe&apos;s secure checkout. Your event activates
              as soon as payment is confirmed.
            </p>
          ) : null}
        </form>
        </div>
      </section>
    </Layout>
  );
}

// Hosts must sign in (Cognito) to create and manage events.
export default withAuthenticator(CreateEventPage);
