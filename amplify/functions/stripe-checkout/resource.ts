import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Creates a Stripe Checkout Session for a plan and returns its hosted URL.
 * Runs server-side with the Stripe secret key (stored as an Amplify secret) so
 * no card data ever touches our app — the host pays on Stripe's hosted page.
 */
export const stripeCheckout = defineFunction({
  name: 'stripe-checkout',
  // Data resolver (custom mutation), so keep it in the data stack alongside the
  // other resolver functions to avoid cross-stack circular dependencies.
  resourceGroupName: 'data',
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    APP_URL: 'https://www.sharepix.net',
  },
});
