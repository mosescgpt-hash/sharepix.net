import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Creates a Stripe billing-portal session so a corporate host can manage or
 * cancel their subscription. Runs with the Stripe secret key; looks up the
 * caller's Stripe customer id from their CorporateSubscription row.
 */
export const corporatePortal = defineFunction({
  name: 'corporate-portal',
  resourceGroupName: 'data',
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    APP_URL: 'https://www.sharepix.net',
  },
});
