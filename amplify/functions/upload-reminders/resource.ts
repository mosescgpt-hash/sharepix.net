import { defineFunction } from '@aws-amplify/backend';

/**
 * Guest upload reminders: opting in, unsubscribing, and the host's switch.
 * One function for the three mutations, dispatched on the field name, because
 * they share the event checks and the opt-in table and nothing else.
 */
export const uploadReminders = defineFunction({
  name: 'upload-reminders',
  resourceGroupName: 'data',
});
