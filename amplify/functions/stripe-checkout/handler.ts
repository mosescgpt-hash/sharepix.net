import Stripe from 'stripe';
import type { Schema } from '../../data/resource';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

type Handler = Schema['createCheckoutSession']['functionHandler'];

// Prices mirror lib/pricing.ts (dollars → cents). Kept in sync by hand so the
// function has no cross-bundle imports.
const TIER_PRICING: Record<string, { name: string; amount: number }> = {
  starter: { name: 'SharePix Starter event', amount: 1000 },
  standard: { name: 'SharePix Standard event', amount: 2500 },
  premium: { name: 'SharePix Premium event', amount: 5000 },
};

export const handler: Handler = async (event) => {
  const tier = (event.arguments.tier ?? '').toLowerCase();
  const pricing = TIER_PRICING[tier];
  if (!pricing) {
    throw new Error('Unknown plan.');
  }

  const appUrl = process.env.APP_URL ?? 'https://www.sharepix.net';
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
    success_url: `${appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/global-admin?checkout=cancelled`,
    metadata: { tier },
  });

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL.');
  }
  return { url: session.url };
};
