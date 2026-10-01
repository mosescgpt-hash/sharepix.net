import { defineFunction } from '@aws-amplify/backend';

/**
 * Tells a Corporate subscriber how many of this month's included events they
 * have used. Read-only: the counter rows are admin-only, so this is the one way
 * a host sees their own, and it can only ever read the caller's.
 */
export const corporateSeats = defineFunction({
  name: 'corporate-seats',
  resourceGroupName: 'data',
});
