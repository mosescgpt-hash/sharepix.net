import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Global-admin health check for the print provider. Prices a one-print order
 * through Prodigi's *quotes* endpoint, which creates nothing and charges
 * nothing, so the live credentials, network path and SKUs can be verified
 * without placing a real order.
 *
 * PRODIGI_API_KEY and PRODIGI_ENV must match print-fulfill's exactly — checking
 * a different key or environment than the one that places orders proves nothing.
 */
export const printProviderCheck = defineFunction({
  name: 'print-provider-check',
  resourceGroupName: 'data',
  // Five sequential HTTPS calls, each bounded at 15s, plus cold start.
  timeoutSeconds: 120,
  environment: {
    PRODIGI_API_KEY: secret('PRODIGI_API_KEY'),
    PRODIGI_ENV: 'live',
  },
});
