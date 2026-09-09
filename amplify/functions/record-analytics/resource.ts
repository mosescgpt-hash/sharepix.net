import { defineFunction } from '@aws-amplify/backend';

/**
 * Records one funnel event.
 *
 * Its own function because the browser is the caller and the table is not
 * something a browser should be able to write freely. This validates the name
 * against the shared vocabulary, bounds the detail, stamps the time server-side
 * and applies the once-per-scope rule as a condition on the write — none of
 * which a model-level create grant could do.
 */
export const recordAnalytics = defineFunction({
  name: 'record-analytics',
  resourceGroupName: 'data',
  timeoutSeconds: 15,
});
