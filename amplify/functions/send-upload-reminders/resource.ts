import { defineFunction } from '@aws-amplify/backend';

/**
 * Sends guest upload reminders and forgets old addresses.
 *
 * Hourly, at five past, because each event's reminders go out at 10:00 in its
 * own time zone — a single daily run would hit 10:00 in one zone and 05:00 or
 * 15:00 in others. The 6-field form is EventBridge cron (minute hour
 * day-of-month month day-of-week year), the same form daily-tasks uses; the
 * installed @aws-amplify/backend-function types accept it, and also accept a
 * { cron, timezone } object, which is not used here because no one zone fits.
 *
 * Idempotent: a reminder is claimed with a conditional write before it is
 * sent, so an overlapping or repeated run sends nothing twice. Sending is off
 * unless EMAIL_SENDING_ENABLED is 'true', the same switch as the host mail.
 */
export const sendUploadReminders = defineFunction({
  name: 'send-upload-reminders',
  resourceGroupName: 'data',
  schedule: '5 * * * ? *',
  timeoutSeconds: 300,
});
