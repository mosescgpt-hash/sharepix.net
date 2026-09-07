import { defineFunction } from '@aws-amplify/backend';

/**
 * Deletes the media of events whose archive window has closed.
 *
 * Its own function, and not a fourth pass inside the daily job, for the same
 * reason the monthly report is separate and a stronger one: the daily job must
 * never stop warning hosts that their gallery is closing, and a job that
 * deletes photos must never be the reason it did. They also want different
 * switches — one sends email, this destroys data — and a single switch over
 * both would eventually be flipped for the wrong one.
 *
 * Runs weekly rather than nightly. Nothing here is time-critical: the grace
 * margin is a week, so a job that runs every seven days still deletes within a
 * fortnight of the boundary, and a destructive job that runs less often has
 * fewer chances to be wrong.
 *
 * It does nothing at all unless STORAGE_RECLAIM_ENABLED is 'true'.
 */
export const reclaimStorage = defineFunction({
  name: 'reclaim-storage',
  resourceGroupName: 'data',
  // Deleting the media of many events means many round trips. The work is
  // bounded per run, so this is a ceiling rather than an expectation.
  timeoutSeconds: 900,
  memoryMB: 512,
  schedule: 'every week',
});
