import { defineFunction } from '@aws-amplify/backend';

/**
 * Counts the bytes an event has stored.
 *
 * Lives in the data stack because that is where the tables it writes are, and
 * it is driven by a queue in the storage stack because that is where the
 * uploads are. That split is the whole point of it existing.
 *
 * sanitize-upload used to do this work inline. Doing so meant a storage-stack
 * function holding grants on data-stack tables, while the data stack has always
 * needed the storage bucket — a circular dependency between two CloudFormation
 * nested stacks, which synthesis does not detect and every deploy failed on.
 * Four deploys in a row, before scripts/check-stack-cycles.mjs existed to name
 * it.
 *
 * A queue turns that cycle into one direction: storage publishes, data
 * consumes, and data already depends on storage.
 */
export const recordBytes = defineFunction({
  name: 'record-bytes',
  resourceGroupName: 'data',
  timeoutSeconds: 60,
});
