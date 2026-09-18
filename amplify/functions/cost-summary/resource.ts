import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * What SharePix costs and earns, for a period.
 *
 * Read-only against every provider it touches: Cost Explorer, Stripe's balance
 * transactions, Cloudflare's analytics API, and the payment tables. It writes
 * exactly one thing — its own cached answer — and moves no money.
 *
 * The Cloudflare pair is deliberately not a `secret()`: the token is read at
 * *synth* time like every other environment variable here, so setting it in the
 * Amplify console does nothing until a backend deploy. That trap has produced
 * two false "it's on" readings in this project, so the handler says which
 * variables are missing rather than silently reporting no R2 cost.
 */
export const costSummary = defineFunction({
  name: 'cost-summary',
  resourceGroupName: 'data',
  // Cost Explorer is slow, Stripe is paginated, and Cloudflare is a round trip
  // to another provider. All three run concurrently, but a cold start plus a
  // slow Cost Explorer call has been known to take most of a minute.
  timeoutSeconds: 120,
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? '',
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
  },
});
