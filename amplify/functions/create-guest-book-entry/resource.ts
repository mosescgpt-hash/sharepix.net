import { defineFunction } from '@aws-amplify/backend';

/**
 * Writes one guest book entry.
 *
 * A guest is unauthenticated, so this is the only thing standing between the
 * open internet and the table: it re-derives the event's state (is it paid, is
 * it open, does it even have a guest book), re-applies every validation rule
 * the browser applied, and proves any attached photo really belongs to this
 * event before it stores a reference to it.
 *
 * Data resolver → data stack, like the other model-adjacent functions.
 */
export const createGuestBookEntry = defineFunction({
  name: 'create-guest-book-entry',
  resourceGroupName: 'data',
});
