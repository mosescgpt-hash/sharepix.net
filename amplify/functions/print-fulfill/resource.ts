import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Background print fulfilment. The Stripe webhook invokes this asynchronously
 * after a paid print checkout, so the webhook can ack Stripe instantly while
 * Prodigi — which can take a long time to create an order (it validates the
 * photo asset synchronously) — is given all the time it needs here.
 */
export const printFulfill = defineFunction({
  name: 'print-fulfill',
  resourceGroupName: 'data',
  timeoutSeconds: 120,
  environment: {
    PRODIGI_API_KEY: secret('PRODIGI_API_KEY'),
    // >>> GO-LIVE TOGGLE <<< The only code change needed to switch Prodigi from
    // testing to real fulfilment. 'sandbox' → api.sandbox.prodigi.com (no real
    // orders/charges); 'live' → api.prodigi.com (real prints + charges).
    // When flipping to 'live', also set PRODIGI_API_KEY to the LIVE key and move
    // Stripe to live mode — see docs/go-live-prints.md.
    PRODIGI_ENV: 'sandbox',
  },
});
