import { defineFunction } from '@aws-amplify/backend';

/**
 * Records what a host thought of their event.
 *
 * Its own function because the row it writes decides whether words get
 * published under somebody's name. A browser that could write the table could
 * set marketingPermission on a stranger's event, or post a five-star
 * testimonial into one, and the consent record beside it would be a lie.
 *
 * The token check, the one-rating-only rule and the refusal to accept a
 * permission grant as anything but an explicit true all live here.
 */
export const submitFeedback = defineFunction({
  name: 'submit-feedback',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
