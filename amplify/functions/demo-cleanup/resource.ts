import { defineFunction } from '@aws-amplify/backend';

/**
 * Sweeps the homepage demo's uploads once they are past their hour.
 *
 * Every fifteen minutes, so the real lifetime of a demo photo is close to the
 * hour the page promises rather than "some time tonight". A daily sweep would
 * make the page's sentence technically aspirational, which is the kind of gap
 * this codebase keeps finding in its own claims.
 *
 * It holds the only delete permission in the product that is not attached to an
 * explicit user action, scoped in `backend.ts` to `demo/*` and nothing else —
 * and the handler checks the prefix again before deleting anything. See the
 * note at the top of the handler for why both.
 *
 * Deliberately has **no enable switch**. `reclaim-storage` has one because it
 * removes a customer's photographs and the safe default is not to. There is no
 * state in which the right behaviour is to keep a stranger's demo upload.
 */
export const demoCleanup = defineFunction({
  name: 'demo-cleanup',
  resourceGroupName: 'storage',
  // A list-and-delete over a prefix that holds minutes of traffic. The bound in
  // the handler stops a backlog from running long.
  timeoutSeconds: 120,
  schedule: 'every 15m',
});
