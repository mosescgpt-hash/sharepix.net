import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

import { DEMO_PREFIX, DEMO_TTL_MINUTES, isDemoExpired, isDemoKey } from './demoUpload';

/**
 * Delete the homepage demo's uploads once they are past their hour.
 *
 * ## Why this is a job and not a page-unload handler
 *
 * The obvious design is to delete the photo when the visitor leaves the page.
 * It cannot be relied on. These visitors are on phones — they scanned a QR code
 * to get here — and on a phone a tab is discarded, an app is switched, a
 * battery dies, and `beforeunload` never fires. Deletion that depends on the
 * browser being polite fails often enough that "deleted when you leave" would
 * be a false promise on a page whose entire argument is that this product is
 * careful with your photographs.
 *
 * So the sweep is the guarantee and the page promises what the sweep delivers.
 *
 * ## Why it is its own function rather than part of reclaim-storage
 *
 * `reclaim-storage` is the only job in this codebase that destroys data, and it
 * is gated behind `STORAGE_RECLAIM_ENABLED`, which ships **off**. Hanging the
 * demo's retention off that switch would mean the promise silently does not
 * hold on any deployment where nobody set it — which is every deployment
 * today. A retention claim that depends on a console value nobody has touched
 * is not a retention claim.
 *
 * This has no switch for the same reason. There is no state in which the right
 * behaviour is to keep a stranger's photo.
 *
 * ## Why deleting is safe here, given nothing else in this codebase deletes
 *
 * `storage/resource.ts` grants delete to nobody, deliberately, so that no
 * signed-in user can remove another event's files. This function holds a
 * delete permission **scoped to `demo/*` and nothing else**, and refuses in
 * code to touch a key outside that prefix even if S3 hands one back. Two
 * independent checks, because the cost of a bug here is somebody's wedding.
 */

const s3 = new S3Client({});
const BUCKET = process.env.PHOTOS_BUCKET_NAME ?? '';

/** S3 deletes up to a thousand keys per request. */
const BATCH = 1000;

/**
 * Bounded so one run cannot spend forever on a backlog.
 *
 * The sweep runs every fifteen minutes, so anything left behind is picked up
 * shortly. A run that tried to clear an enormous backlog in one go would time
 * out and clear nothing, which is the worse failure.
 */
const MAX_PER_RUN = 10_000;

export const handler = async (): Promise<{ scanned: number; deleted: number }> => {
  if (!BUCKET) {
    console.error('DEMO CLEANUP NOT RUN', { reason: 'PHOTOS_BUCKET_NAME is not set' });
    return { scanned: 0, deleted: 0 };
  }

  const now = new Date();
  let token: string | undefined;
  let scanned = 0;
  let deleted = 0;
  let expired: { Key: string }[] = [];

  const flush = async () => {
    if (expired.length === 0) return;
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: expired, Quiet: true },
      }),
    );
    deleted += expired.length;
    expired = [];
  };

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        // Listing is scoped to the prefix, so nothing else is even enumerated.
        Prefix: DEMO_PREFIX,
        ContinuationToken: token,
      }),
    );

    for (const object of page.Contents ?? []) {
      const key = object.Key;
      if (!key) continue;
      scanned += 1;

      // The second check. The prefix above should make this impossible, and it
      // is here anyway: this is the only code in the product that deletes
      // somebody's photograph without being asked to, and a listing bug must
      // not be the thing standing between it and an event's gallery.
      if (!isDemoKey(key)) {
        console.error('DEMO CLEANUP REFUSED A KEY', { key });
        continue;
      }

      // Age from S3's own timestamp rather than anything in the key. A key is
      // written by the browser; LastModified is written by S3.
      const uploadedAt = object.LastModified;
      if (!uploadedAt || !isDemoExpired(uploadedAt, now)) continue;

      expired.push({ Key: key });
      if (expired.length >= BATCH) await flush();
      if (deleted >= MAX_PER_RUN) break;
    }

    token = page.NextContinuationToken;
  } while (token && deleted < MAX_PER_RUN);

  await flush();

  // Logged every run, including the quiet ones: this job existing and doing
  // nothing is indistinguishable from this job not running, and the difference
  // is whether a promise on the homepage is being kept.
  console.log('Demo cleanup', {
    at: now.toISOString(),
    ttlMinutes: DEMO_TTL_MINUTES,
    scanned,
    deleted,
  });

  return { scanned, deleted };
};
