import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Guest-facing: starts a Stripe Checkout Session for a print order of one or
 * more of an event's photos. Runs server-side with the Stripe secret so no card
 * data touches the app. Prices come from the inlined catalog (Prodigi base ×
 * margin, mirroring lib/prints.ts). The Prodigi order itself is placed by the
 * Stripe webhook once payment completes.
 */
export const printCheckout = defineFunction({
  name: 'print-checkout',
  // Data resolver (custom mutation): keep it in the data stack alongside the
  // other resolver functions to avoid cross-stack circular dependencies.
  resourceGroupName: 'data',
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    APP_URL: 'https://www.sharepix.net',
  },
});
