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
    PRODIGI_ENV: 'sandbox',
  },
});
