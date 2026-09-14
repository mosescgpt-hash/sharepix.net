import { defineFunction } from '@aws-amplify/backend';

/**
 * Copies pre-1-September uploads into R2, one press at a time.
 *
 * 900s is the Lambda maximum and the handler stops working at 12 minutes, so a
 * run always has room to finish the copy in flight and write its response. A
 * timeout would lose the continuation token and send the next run back to the
 * start of the bucket.
 *
 * 512MB because objects are streamed rather than buffered — the memory is for
 * the SDK and the stream chunks, not for whole videos.
 */
export const backfillR2 = defineFunction({
  name: 'backfill-r2',
  resourceGroupName: 'data',
  memoryMB: 512,
  timeoutSeconds: 900,
});
