import { defineFunction } from '@aws-amplify/backend';

/**
 * Booth mode, step 5 (docs/booth-mode.md): emails each attendee their gallery
 * link once the photographer approves their photos (and once more when more
 * are approved), reminds them a week before the full-resolution originals are
 * removed, and removes them 30 days after the event. Hourly, at :20.
 *
 * Also backs boothResendEmail, the host's Resend button.
 *
 * Idempotent: each email is claimed with a conditional write before it is
 * sent. Sending is off unless EMAIL_SENDING_ENABLED is 'true', the same switch
 * as all customer mail.
 */
export const boothDeliveries = defineFunction({
  name: 'booth-deliveries',
  resourceGroupName: 'data',
  schedule: '20 * * * ? *',
  timeoutSeconds: 600,
});
