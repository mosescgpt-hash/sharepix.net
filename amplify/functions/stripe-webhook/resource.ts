import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Public endpoint (Function URL) that Stripe calls when a payment completes.
 * It verifies Stripe's signature with the webhook signing secret, then records
 * the payment. Card data never passes through here — only the event summary.
 */
export const stripeWebhook = defineFunction({
  name: 'stripe-webhook',
  resourceGroupName: 'data',
  // Submitting a print order to Prodigi (sign the image URL, create the order,
  // write back) can take a long time — Prodigi appears to fetch/validate the
  // photo asset synchronously. Give it generous room, above the 100s cutoff on
  // the Prodigi fetch itself so an abort is a clean logged 500, not a 502.
  timeoutSeconds: 120,
  environment: {
    STRIPE_WEBHOOK_SECRET: secret('STRIPE_WEBHOOK_SECRET'),
    // Prints fulfillment: after a print checkout completes, the webhook submits
    // the order to Prodigi with this key. PRODIGI_ENV selects the API host:
    // `live` → api.prodigi.com, anything else → api.sandbox.prodigi.com.
    PRODIGI_API_KEY: secret('PRODIGI_API_KEY'),
    PRODIGI_ENV: 'sandbox',
  },
});
