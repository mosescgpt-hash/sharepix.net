import { defineFunction } from '@aws-amplify/backend';

/**
 * Booth mode sign-up: an attendee gives their name and email and gets the QR
 * token the photographer scans. The only writer of BoothAttendee rows. See
 * docs/booth-mode.md and handler.ts.
 */
export const boothSignup = defineFunction({
  name: 'booth-signup',
  resourceGroupName: 'data',
});
