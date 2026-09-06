import { defineFunction } from '@aws-amplify/backend';

/**
 * The product's first scheduled job.
 *
 * Until this existed nothing in SharePix ran on a clock — the only `Rule` in
 * the backend was an S3 lifecycle rule — so every lifecycle programme in the
 * strategy documents (expiry reminders, the post-event survey, the growth loop,
 * the monthly report) was unbuildable regardless of how completely it was
 * specified. This is the thing they were all waiting on, proved by doing one
 * real job rather than by existing.
 *
 * ## The schedule
 *
 * 14:00 UTC, daily. Deliberately a fixed hour rather than `every day`, which
 * anchors to deploy time and therefore moves whenever we ship. A reminder that
 * arrives at 3am for half the audience is a reminder people resent, and 14:00
 * UTC is mid-morning in North America and afternoon in Europe.
 *
 * The job is idempotent (see EventNotification in data/resource.ts), so a
 * double-fire sends nothing twice and a missed day is caught by the two-day
 * window in lib/eventReminders.ts.
 *
 * ## Deploying it switched off
 *
 * `EMAIL_SENDING_ENABLED` gates every actual send. It ships unset, which means
 * the job runs, works out exactly who it would email, logs all of it, and sends
 * nothing. That is how a job that mails real customers gets to be observed in
 * production before it is trusted — the alternative is finding out it addresses
 * everyone as "undefined" from a customer.
 *
 * Ten minutes is generous for a table scan and a handful of sends, and it is
 * bounded: a job that hangs holds nothing else up, but it should still stop.
 */
export const dailyTasks = defineFunction({
  name: 'daily-tasks',
  resourceGroupName: 'data',
  schedule: '0 14 * * ? *',
  timeoutSeconds: 600,
});
