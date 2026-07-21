import { FormEvent, useState } from 'react';
import { useRouter } from 'next/router';
import { withAuthenticator } from '@aws-amplify/ui-react';
import Layout from '@/components/Layout';
import EventQRCode from '@/components/EventQRCode';
import { PRICING_TIERS, getTier } from '@/lib/pricing';
import { createNewEvent, redeemDiscountCode, validateDiscountCode } from '@/lib/api';
import { QREvent } from '@/lib/types';

function CreateEventPage() {
  const router = useRouter();
  const initialTier = typeof router.query.tier === 'string' ? router.query.tier : 'standard';

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [tierId, setTierId] = useState(getTier(initialTier) ? initialTier : 'standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdEvent, setCreatedEvent] = useState<QREvent | null>(null);
  const [pilotCode, setPilotCode] = useState('');
  const [pilotCodeStatus, setPilotCodeStatus] = useState<
    'idle' | 'checking' | 'valid' | 'invalid'
  >('idle');
  const [pilotCodeMessage, setPilotCodeMessage] = useState<string | null>(null);

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

      // The code carries the plan it unlocks — switch the event to that plan.
      const unlockedTier =
        result.appliesToTier && getTier(result.appliesToTier) ? result.appliesToTier : tierId;
      setTierId(unlockedTier);
      setPilotCodeStatus('valid');
      setPilotCodeMessage(
        `Pilot access applied to the ${getTier(unlockedTier)?.name ?? 'selected'} plan.`,
      );
    } catch {
      setPilotCodeStatus('invalid');
      setPilotCodeMessage('We could not check that code. Please try again.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pilotCodeStatus !== 'valid') {
      setError('Apply a valid pilot code to create your event free during the pilot.');
      return;
    }
    if (!name.trim()) {
      setError('Give your event a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const redemption = await redeemDiscountCode(pilotCode, tierId);
      if (!redemption.valid) {
        setPilotCodeStatus('invalid');
        setPilotCodeMessage(redemption.message ?? 'That pilot code can no longer be used.');
        throw new Error(redemption.message ?? 'That pilot code can no longer be used.');
      }
      const event = await createNewEvent({ name: name.trim(), date, tier: tierId });
      setCreatedEvent(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong creating the event.';
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (createdEvent) {
    const tier = getTier(createdEvent.tier);
    return (
      <Layout title="Event created">
        <section className="mx-auto max-w-lg py-10">
          <h1 className="text-center font-display text-3xl font-extrabold">
            🎉 {createdEvent.name} is live
          </h1>
          <p className="mt-2 text-center text-ink/70">
            Event code: <strong>{createdEvent.eventCode}</strong>
          </p>
          <div className="mt-8">
            <EventQRCode
              eventId={createdEvent.id}
              eventName={createdEvent.name}
              allowCustomization={tier?.id !== 'starter'}
            />
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => router.push(`/event/${createdEvent.id}`)}
              className="flex-1 rounded-full bg-ink py-3 text-center font-medium text-white hover:bg-night"
            >
              View gallery
            </button>
            <button
              type="button"
              onClick={() => router.push(`/event/${createdEvent.id}/admin`)}
              className="flex-1 rounded-full border border-ink/20 py-3 text-center font-medium hover:border-accent hover:text-accent"
            >
              Open admin dashboard
            </button>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout title="Create an event">
      <section className="mx-auto max-w-lg py-10">
        <h1 className="font-display text-3xl font-extrabold">Create your event</h1>
        <p className="mt-2 text-ink/70">
          Name your event, choose a plan, and get your QR code instantly.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
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
              className="mt-1 w-full rounded-xl border border-ink/20 bg-white px-4 py-3 focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="event-date" className="block text-sm font-medium">
              Event date <span className="text-ink/50">(optional)</span>
            </label>
            <input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ink/20 bg-white px-4 py-3 focus:border-accent focus:outline-none"
            />
          </div>

          <fieldset>
            <legend className="text-sm font-medium">Plan</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {PRICING_TIERS.map((tier) => (
                <label
                  key={tier.id}
                  className={`cursor-pointer rounded-xl border p-3 text-sm ${
                    tierId === tier.id ? 'border-accent bg-accent/5' : 'border-ink/20 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="tier"
                    value={tier.id}
                    checked={tierId === tier.id}
                    onChange={() => {
                      setTierId(tier.id);
                      // A code is tied to a plan, so switching plans clears it.
                      if (pilotCodeStatus !== 'idle') {
                        setPilotCodeStatus('idle');
                        setPilotCodeMessage(null);
                      }
                    }}
                    className="sr-only"
                  />
                  <span className="block font-display font-bold">{tier.name}</span>
                  <span className="block text-ink/70">${tier.price} / event</span>
                  <span className="block text-xs text-ink/50">
                    {tier.photoLimit ? `${tier.photoLimit.toLocaleString()} photos` : 'Unlimited photos'} ·{' '}
                    {tier.accessLabel}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-2xl border border-ink/10 bg-white p-4">
            <label htmlFor="pilot-code" className="block font-display font-bold">
              Have a pilot access code?
            </label>
            <p className="mt-1 text-sm text-ink/60">
              Apply it to make your event free during the sharepix.net pilot. The code sets the plan.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                id="pilot-code"
                type="text"
                value={pilotCode}
                onChange={(e) => {
                  setPilotCode(e.target.value);
                  if (pilotCodeStatus !== 'idle') {
                    setPilotCodeStatus('idle');
                    setPilotCodeMessage(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void applyPilotCode();
                  }
                }}
                placeholder="Enter pilot code"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-ink/20 px-4 py-3 uppercase focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void applyPilotCode()}
                disabled={pilotCodeStatus === 'checking'}
                className="rounded-xl border border-ink/20 px-5 py-3 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
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
                <span className="text-ink/50 line-through">${getTier(tierId)?.price}</span>{' '}
                <span className="text-accent">$0</span>
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={busy || pilotCodeStatus !== 'valid'}
            className="w-full rounded-full bg-ink py-3 font-medium text-white hover:bg-night disabled:opacity-50"
          >
            {busy
              ? 'Creating…'
              : pilotCodeStatus === 'valid'
                ? 'Create free event & get QR code'
                : 'Apply pilot code to continue'}
          </button>
        </form>
      </section>
    </Layout>
  );
}

// Hosts must sign in (Cognito) to create and manage events.
export default withAuthenticator(CreateEventPage);
