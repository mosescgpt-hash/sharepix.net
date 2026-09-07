import { defineFunction } from '@aws-amplify/backend';

/**
 * The monthly business summary, emailed to whoever runs SharePix.
 *
 * Its own function rather than a branch of the daily job. The daily job already
 * scans every event and could do this on the 1st for free, but the two have
 * completely different failure modes: the daily one must never stop warning
 * hosts about deletion, and this one must never be the reason it did. Once a
 * month a second scan costs cents.
 *
 * 15:00 UTC on the 1st, reporting the calendar month that just ended — so every
 * figure in it is final. A report covering a month still in progress invites
 * comparing eleven days against thirty.
 *
 * `REPORT_TO_ADDRESS` unset means nothing is sent. Like every other send in
 * this codebase, it ships off.
 */
export const monthlyReport = defineFunction({
  name: 'monthly-report',
  resourceGroupName: 'data',
  schedule: '0 15 1 * ? *',
  timeoutSeconds: 300,
});
