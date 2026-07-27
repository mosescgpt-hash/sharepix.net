import Stripe from 'stripe';
import type { Schema } from '../../data/resource';

type Handler = Schema['createCheckoutSession']['functionHandler'];

// Prices mirror lib/pricing.ts (dollars → cents). Kept in sync by hand so the
// function has no cross-bundle imports.
const TIER_PRICING: Record<string, { name: string; amount: number }> = {
  starter: { name: 'SharePix Starter event', amount: 1000 },
  standard: { name: 'SharePix Standard event', amount: 2500 },
  premium: { name: 'SharePix Premium event', amount: 5000 },
};

export const handler: Handler = async (event) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing.');
  }
  if (!secretKey.startsWith('sk_')) {
    throw new Error(
      'STRIPE_SECRET_KEY does not look like a secret key (it should start with "sk_"). Check that the secret key — not the publishable key — was saved.',
    );
  }

  const appBaseUrl = process.env.APP_URL ?? 'https://www.sharepix.net';

  // Corporate: a recurring $149/month subscription rather than a one-time event
  // payment. We stamp the caller's id (and owner string) into metadata so the
  // webhook can attach the subscription to their account.
  if ((event.arguments.kind ?? '') === 'corporate') {
    const identity = event.identity as
      | { sub?: string; username?: string; claims?: { email?: string } }
      | undefined;
    const sub = identity?.sub;
    if (!sub) {
      throw new Error('You must be signed in to subscribe.');
    }
    const owner = `${sub}::${identity?.username ?? ''}`;
    const email = identity?.claims?.email;
    const metadata = { kind: 'corporate', userId: sub, owner };
    try {
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer_email: email || undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: 14900,
              recurring: { interval: 'month' },
              product_data: { name: 'SharePix Corporate (monthly)' },
            },
          },
        ],
        success_url: `${appBaseUrl}/corporate?subscribed=1`,
        cancel_url: `${appBaseUrl}/corporate?checkout=cancelled`,
        metadata,
        subscription_data: { metadata },
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Stripe subscription checkout failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Guest-download add-on: a one-time $15 charge that enables guest downloads on
  // a single event. The webhook flips the event's guestDownloadEnabled flag.
  if ((event.arguments.kind ?? '') === 'guest_download') {
    const addOnEventId = event.arguments.eventId ?? '';
    if (!addOnEventId) throw new Error('Missing event for the download add-on.');
    try {
      const stripe = new Stripe(secretKey);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: 1500,
              product_data: { name: 'SharePix guest-download add-on (one event)' },
            },
          },
        ],
        success_url: `${appBaseUrl}/event/${addOnEventId}/admin?addon=guestdownload`,
        cancel_url: `${appBaseUrl}/event/${addOnEventId}/admin?addon=cancelled`,
        metadata: { kind: 'guest_download', eventId: addOnEventId },
      });
      if (!session.url) throw new Error('Stripe did not return a checkout URL.');
      return { url: session.url };
    } catch (error) {
      throw new Error(
        `Stripe add-on checkout failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const tier = (event.arguments.tier ?? '').toLowerCase();
  const pricing = TIER_PRICING[tier];
  if (!pricing) {
    throw new Error('Unknown plan.');
  }

  // Optional: the pending event this payment activates once it completes.
  const eventId = event.arguments.eventId ?? '';

  const appUrl = process.env.APP_URL ?? 'https://www.sharepix.net';
  // When paying for a real event, land back on a page that activates it; the
  // admin test checkout (no eventId) keeps the generic success page.
  const successUrl = eventId
    ? `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}&eventId=${encodeURIComponent(eventId)}`
    : `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = eventId
    ? `${appUrl}/my-events?checkout=cancelled`
    : `${appUrl}/global-admin?checkout=cancelled`;
  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: pricing.amount,
            product_data: { name: pricing.name },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tier, eventId },
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    return { url: session.url };
  } catch (error) {
    throw new Error(`Stripe checkout failed: ${error instanceof Error ? error.message : String(error)}`);
  }
};
