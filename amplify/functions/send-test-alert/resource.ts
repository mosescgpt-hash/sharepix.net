import { defineFunction } from '@aws-amplify/backend';

/**
 * Global-admin check that alert email actually arrives.
 *
 * The only way to see a real "photo held for review" alert is to get a photo
 * flagged, which cannot be done on demand with ordinary pictures — so the first
 * time anyone saw one would otherwise be a live event. This sends the same
 * message, built by the same code, to the admin who asked for it.
 *
 * Permissions, the sender address and the app URL are wired in backend.ts,
 * deliberately mirroring the create-event-photo function: a test that ran with
 * different configuration would prove nothing about the real path.
 */
export const sendTestAlert = defineFunction({
  name: 'send-test-alert',
  resourceGroupName: 'data',
  timeoutSeconds: 60,
});
