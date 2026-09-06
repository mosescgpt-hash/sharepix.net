import { defineFunction } from '@aws-amplify/backend';

/**
 * Honours an unsubscribe link.
 *
 * Its own function, and not something the browser does directly, because the
 * EmailPreference table holds email addresses: granting the client write access
 * would mean granting it read access to decide what to write, and a table of
 * customer addresses that any signed-out visitor can query is a harvest.
 *
 * The link carries the address and a random token. This checks that the token
 * matches the one stored for that address before changing anything, so an
 * unsubscribe cannot be forged from a guessed email — otherwise anyone could
 * silently opt a competitor's customers out of their own mail, and the first
 * sign would be someone wondering why they stopped hearing from us.
 */
export const unsubscribeEmail = defineFunction({
  name: 'unsubscribe-email',
  resourceGroupName: 'data',
  timeoutSeconds: 30,
});
