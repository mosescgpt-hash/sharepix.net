// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Schema } from '../../data/resource';
import { MAX_KEYS_PER_REQUEST, canSign, dedupeKeys } from './access';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

/** How long a signed URL stays valid. Long enough to download a 250 MB video. */
const URL_TTL_SECONDS = 15 * 60;

function r2(): S3Client | null {
  const endpoint = process.env.R2_ACCOUNT_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !process.env.R2_BUCKET || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * What guests may currently see, mirroring lib/lifecycle.ts. Duplicated rather
 * than imported because Amplify functions take no cross-bundle imports; the
 * rule is simple and its inputs are on the row.
 */
function guestResolutionOf(
  item: Record<string, { S?: string; BOOL?: boolean }>,
): 'full' | 'small' | 'none' {
  const windowEnd = item.uploadWindowEndsAt?.S;
  const accessEnd = item.accessExpiresAt?.S;
  const now = Date.now();
  if (accessEnd && now > new Date(accessEnd).getTime()) return 'none';
  if (windowEnd && now > new Date(windowEnd).getTime()) return 'small';
  return 'full';
}

type Handler = Schema['mediaUrls']['functionHandler'];

/**
 * Signed R2 URLs for a batch of stored objects.
 *
 * Batched because a gallery needs one per photo. The first version of this
 * signed a single key, which was fine for downloads — one file, one deliberate
 * click — and unusable for a 500-photo gallery, where it would have meant 500
 * GraphQL round trips and 500 Lambda invocations to open one page.
 *
 * A key that can't be served comes back with a null url and the caller uses S3.
 * Note what is NOT here: an existence check. Signing is local HMAC — no network
 * call per key — so the expensive part of a HEAD-per-object would be the one
 * thing that doesn't scale to a gallery. It also isn't needed: a signed URL for
 * an object R2 doesn't have returns 404, and every caller already treats a
 * failed fetch as "use S3" (an image swaps its src, a download falls through to
 * downloadData). The 404 costs one request and no bytes.
 */
export const handler: Handler = async (event) => {
  const eventId = (event.arguments?.eventId ?? '').toString();
  const requested = (event.arguments?.keys ?? []).map((key) => (key ?? '').toString());

  // Bounded before anything else runs: the cap is what stops one request asking
  // for an unbounded amount of signing work.
  const keys = dedupeKeys(requested, MAX_KEYS_PER_REQUEST);
  if (keys.length === 0) return [];

  const client = r2();
  // Not configured, or configured badly: say so plainly and let the caller use
  // S3. This is the default, and it is why merging never changed behaviour.
  if (!client) return keys.map((key) => ({ key, url: null }));

  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  if (!found?.Item) return keys.map((key) => ({ key, url: null }));

  // One row read for the whole batch — the access rules are per-key but the
  // event state they read is not.
  const eventState = {
    owner: found.Item.owner?.S ?? '',
    guestDownloadsBlocked: found.Item.guestDownloadsBlocked?.BOOL === true,
    guestResolution: guestResolutionOf(found.Item),
  };
  const caller = event.identity as { sub?: string | null; groups?: string[] | null } | undefined;

  return Promise.all(
    keys.map(async (key) => {
      const decision = canSign({ eventId, key, event: eventState, caller });
      if (!decision.allowed) return { key, url: null };
      try {
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
          { expiresIn: URL_TTL_SECONDS },
        );
        return { key, url };
      } catch (error) {
        console.error('Could not sign an R2 URL (falling back to S3)', {
          at: new Date().toISOString(),
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        return { key, url: null };
      }
    }),
  );
};
