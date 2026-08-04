import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Public endpoint (Function URL) that Stripe calls when a payment completes.
 * It verifies Stripe's signature with the webhook signing secret, then records
 * the payment. Card data never passes through here — only the event summary.
 */
export const stripeWebhook = defineFunction({
  name: 'stripe-webhook',
  resourceGroupName: 'data',
  // The webhook only verifies the event, records the payment, and hands print
  // fulfilment to the background print-fulfill function — all fast, so it acks
  // Stripe well within Stripe's own timeout. Prodigi's slowness lives in
  // print-fulfill now, not here.
  timeoutSeconds: 15,
  environment: {
    STRIPE_WEBHOOK_SECRET: secret('STRIPE_WEBHOOK_SECRET'),
  },
});
