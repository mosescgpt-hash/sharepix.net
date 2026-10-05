import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { withHostAuth } from '@/components/hostAuth';
import Layout from '@/components/Layout';
import Notice from '@/components/Notice';
import EventQRCode from '@/components/EventQRCode';
import {
  CORPORATE_PLAN,
  PRICING_TIERS,
  applyDiscount,
  getTier,
  isSellableTier,
  isTrialTier,
} from '@/lib/pricing';
import {
  applyStarterLook,
  createNewEvent,
  getMyCorporateSubscription,
  isCorporateActive,
  startCheckout,
  validateDiscountCode,
  trackEvent,
} from '@/lib/api';
import { UPLOAD_WINDOW_DAYS, latestEventDate } from '@/lib/uploadWindowStart';
import { QREvent } from '@/lib/types';
import {
  AUDIENCE_HELP,
  AUDIENCE_OPTIONS,
  AUDIENCE_QUESTION,
} from '@/lib/eventAudience';
import { EVENT_TYPES, eventTypeFor, type EventTypeOption } from '@/lib/eventTypes';
import { starterLookFor } from '@/lib/starterLooks';
import { coverPresetFor } from '@/lib/eventCover';
import { fontSetFor } from '@/lib/galleryTheme';
import { artworkFor } from '@/lib/imagery';

function CreateEventPage() {
  // The Decide stage opening. This page is behind the authenticator, so
  // reaching it means somebody has an account and is setting an event up —
  // which is exactly the step the funnel could not see before.
  useEffect(() => {
    trackEvent('create_event_started');
  }, []);

  const router = useRouter();
  // `free` is the retired trial id; links that still carry it mean the free event.
  const queryTier = typeof router.query.tier === 'string' ? router.query.tier : 'plus';
  const initialTier = queryTier === 'free' ? 'trial' : queryTier;
  // Where they came from, carried in the link. A claim only — the create-event
  // function normalises it against a closed set before anything is stored, so
  // an edited query string cannot put free text on an event row.
  const source = typeof router.query.source === 'string' ? router.query.source : '';

  // Step one is the kind of event; everything after it is narrowed by the
  // answer. A link can carry it (`?type=wedding`, from a wedding page) and
  // skip straight to step two.
  const [eventType, setEventType] = useState<EventTypeOption | null>(null);
  const [lookKey, setLookKey] = useState('signature');
  useEffect(() => {
    const fromLink = eventTypeFor(
      typeof router.query.type === 'string' ? router.query.type : null,
    );
    if (fromLink && !eventType) chooseType(fromLink);
  }, [router.query.type]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseType(option: EventTypeOption) {
    setEventType(option);
    setLookKey(option.looks[0]);
    if (!option.asksAudience) setAudience('guests');
    window.scrollTo({ top: 0 });
  }

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  // Who the QR signs will be addressed to. Defaults to guests because that is
  // the common case. Only asked for the event types where "just me" is common
  // (see asksAudience in lib/eventTypes.ts); everyone else can change it later
  // under Guests.
  const [audience, setAudience] = useState<'guests' | 'host-only'>('guests');
  // A link to a retired plan (an old bookmark, a stale email) must not select
  // something that is no longer for sale.
  const [tierId, setTierId] = useState(isSellableTier(initialTier) ? initialTier : 'plus');
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
  // A trial is not a purchase: no code, no checkout, no payment reassurance.
  const isTrial = isTrialTier(tierId);
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
        tier: tierId,
        uploadAudience: audience,
        discountCode: pilotCodeStatus === 'valid' ? pilotCode : undefined,
        source,
        eventType: eventType?.value,
      });

      // The look, saved before anything else happens, so the gallery looks
      // finished the first time anyone opens it. A failure here costs the host
      // nothing but the default style: the event exists and they can pick a
      // look from the Design tab.
      const look = starterLookFor(lookKey);
      if (look) await applyStarterLook(event.id, look).catch(() => undefined);

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
              allowCustomization={tier?.customQrCode === true}
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

  if (!eventType) {
    const pictured = EVENT_TYPES.filter((t) => t.image);
    const others = EVENT_TYPES.filter((t) => !t.image);
    return (
      <Layout title="Create an event" width="bleed">
        <section className="spx-section-ink py-10 sm:py-14">
          <div className="mx-auto w-full max-w-3xl">
            <p className="spx-eyebrow">Step 1 of 2</p>
            <h1 className="mt-3">
              <span className="spx-display block">What are you celebrating?</span>
            </h1>
            <p className="spx-body mt-4">
              We&apos;ll set up a gallery that suits it. You can change everything later.
            </p>
          </div>
        </section>

        <section className="spx-section-canvas py-10 sm:py-14">
          <div className="mx-auto w-full max-w-3xl">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {pictured.map((option) => {
                const art = artworkFor(option.image!);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => chooseType(option)}
                    className="group relative aspect-[4/3] overflow-hidden border border-charcoal/15 text-left transition hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
                  >
                    {art.kind === 'photo' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={art.src}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <span className="absolute inset-0 bg-ink" />
                    )}
                    <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <span className="absolute bottom-3 left-3 right-3 font-sans text-base font-semibold text-white sm:text-lg">
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {others.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => chooseType(option)}
                  className="border border-charcoal/15 bg-paper px-4 py-4 text-left text-sm font-medium transition hover:border-ink"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  const look = starterLookFor(lookKey);
  const lookCover = coverPresetFor(look?.coverPreset);
  const lookFonts = fontSetFor(look?.galleryFontSet);

  return (
    <Layout title="Create an event" width="bleed">
      <section className="spx-section-ink py-10 sm:py-14">
        <div className="mx-auto w-full max-w-lg">
          <p className="spx-eyebrow">Step 2 of 2 · {eventType.label}</p>
          <h1 className="mt-3">
            <span className="spx-display block">Name it.</span>
            <span className="spx-display-serif block">Your QR code is next.</span>
          </h1>
          <button
            type="button"
            onClick={() => setEventType(null)}
            className="mt-4 text-sm text-canvas/70 underline underline-offset-4 hover:text-canvas"
          >
            Change event type
          </button>
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
              placeholder={eventType.namePlaceholder}
              maxLength={80}
              autoFocus
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
              // The browser's own picker refuses what the server would refuse,
              // so nobody fills the form in and then gets turned away. The
              // server check in create-event is still the fence — this is a
              // courtesy, and a date input's max is trivially edited.
              max={latestEventDate()}
              aria-describedby="event-date-help"
              className="spx-input mt-2"
            />
            {/* The window used to run from the moment the event was created,
                which meant a host setting up early spent it on an empty
                gallery. It now runs from the date — so the date is worth
                saying something about rather than leaving as a bare field. */}
            <p id="event-date-help" className="mt-1.5 text-sm text-charcoal/70">
              {date
                ? `Guests can upload for ${UPLOAD_WINDOW_DAYS} days after this date.`
                : `Uploads run for ${UPLOAD_WINDOW_DAYS} days. With a date set they start from the event; without one they start once the gallery is being used.`}
            </p>
          </div>

          {/* The look, chosen for them and shown with their own name in it, so
              the first thing they see of their gallery already looks finished.
              Three that suit the event type; the rest are in the Design tab. */}
          <fieldset>
            <legend className="text-sm font-medium text-charcoal">Your gallery&apos;s look</legend>
            <div
              className={`mt-2 border border-charcoal/15 px-6 py-10 text-center ${
                lookCover.tone === 'light' ? 'text-ink' : 'text-canvas'
              }`}
              style={{ background: lookCover.background }}
            >
              <p
                className="text-3xl leading-tight sm:text-4xl"
                style={{ fontFamily: lookFonts.heading }}
              >
                {name.trim() || eventType.namePlaceholder}
              </p>
              {date ? (
                <p className="mt-2 text-sm opacity-80" style={{ fontFamily: lookFonts.body }}>
                  {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {eventType.looks.map((key) => {
                const option = starterLookFor(key);
                if (!option) return null;
                const active = key === lookKey;
                return (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm transition ${
                      active
                        ? 'border-ink bg-ink text-canvas'
                        : 'border-charcoal/15 bg-paper hover:border-charcoal/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="look"
                      value={key}
                      checked={active}
                      onChange={() => setLookKey(key)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className="inline-block h-3.5 w-3.5 rounded-full border border-charcoal/20"
                      style={{ background: coverPresetFor(option.coverPreset).background }}
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-charcoal/55">
              Add your own cover photo and fine-tune it any time from your dashboard.
            </p>
          </fieldset>

          {/* Asked here only where "just me" is a common answer — a church or
              a school sharing with parents. The counts can tell you afterwards
              that one person uploaded; they cannot tell you whether that was
              the plan. See lib/eventAudience.ts. */}
          {eventType.asksAudience ? (
          <fieldset>
            <legend className="text-sm font-medium text-charcoal">{AUDIENCE_QUESTION}</legend>
            <p className="mt-1 text-xs text-charcoal/55">{AUDIENCE_HELP}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {AUDIENCE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer border p-4 text-sm transition ${
                    audience === option.value
                      ? 'border-ink bg-ink text-canvas'
                      : 'border-charcoal/15 bg-paper hover:border-charcoal/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="audience"
                    value={option.value}
                    checked={audience === option.value}
                    onChange={() => setAudience(option.value)}
                    className="sr-only"
                  />
                  <span className="block font-medium">{option.label}</span>
                  <span
                    className={`mt-1 block text-xs ${
                      audience === option.value ? 'text-canvas/70' : 'text-charcoal/55'
                    }`}
                  >
                    {option.detail}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          ) : null}

          <fieldset>
            <legend className="text-sm font-medium text-charcoal">Plan</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
                  <span className="block text-charcoal/70">
                    {tier.trial ? 'Free · one per account' : `$${tier.price} / event`}
                  </span>
                  <span className="block text-xs text-charcoal/55">
                    {tier.photoLimit
                      ? `${tier.photoLimit.toLocaleString()} photos`
                      : 'Unlimited photos under fair use'}{' '}
                    ·{' '}
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
                    {CORPORATE_PLAN.includedEvents} new events included each month
                  </span>
                  <span className="block text-xs text-charcoal/55">
                    Beyond that, ${CORPORATE_PLAN.extraEventPrice} per extra event at checkout ·
                    Unlimited photos under fair use · 1-year host access
                  </span>
                </span>
              </label>
            ) : null}
          </fieldset>

          {isTrial ? null : (
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
          )}

          {error ? (
            <Notice tone="error">{error}</Notice>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="spx-btn-ink w-full disabled:opacity-50"
          >
            {busy
              ? tierId === 'corporate' || isComped || isTrial
                ? 'Creating…'
                : 'Sending you to checkout…'
              : tierId === 'corporate'
                ? 'Create corporate event & get QR code'
                : isComped || isTrial
                  ? 'Create free event & get QR code'
                  : `Continue to payment · $${isDiscounted ? discountedPrice : basePrice}`}
          </button>
          {tierId !== 'corporate' && !isComped && !isTrial ? (
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
export default withHostAuth(CreateEventPage, {
  purpose: 'Set up your event gallery.',
  arriving: 'new',
});
