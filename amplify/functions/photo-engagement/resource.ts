import { defineFunction } from '@aws-amplify/backend';

/**
 * Likes and comments from guests.
 *
 * Its own function because the count on a photo and the row that causes it have
 * to move together. A browser that could write either directly could set a
 * count without a like behind it, or leave a like that no count reflects, and
 * the two would drift apart on the first failure.
 *
 * It is also where the host's switches are enforced. A gallery that has turned
 * comments off must actually refuse them, not merely stop rendering the box —
 * the box is not the boundary.
 */
export const photoEngagement = defineFunction({
  name: 'photo-engagement',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
