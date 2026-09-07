import { defineFunction } from '@aws-amplify/backend';

/**
 * Files a Guest Upload Promise claim.
 *
 * Its own function because every input that decides whether money goes back
 * has to come from the server: whether the caller owns the event, whether it
 * was paid for, whether any guest uploaded, whether the claim window is open,
 * and — above all — how much was actually paid.
 *
 * A browser that could write this row could name its own amount. So it cannot
 * write the row at all; it can only ask, and this decides.
 *
 * Note what this does NOT do: refund anything. It creates a REQUESTED row in a
 * queue a person works. Nothing in this codebase calls Stripe's refund API.
 */
export const claimRefund = defineFunction({
  name: 'claim-refund',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
