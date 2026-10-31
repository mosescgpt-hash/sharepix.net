import { defineFunction } from '@aws-amplify/backend';

/**
 * Reads an event's diagnostic logs for the people allowed to see them.
 *
 * Its own function, and not a model read, because "who may read this" is a
 * question about the event's owner and the ClientLog model has none to ask.
 * The model itself grants only the ADMINS group; hosts get their own event's
 * logs here, after an owner check, and nobody gets anyone else's.
 */
export const eventDiagnostics = defineFunction({
  name: 'event-diagnostics',
  resourceGroupName: 'data',
  timeoutSeconds: 20,
});
