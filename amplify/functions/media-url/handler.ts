// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Schema } from '../../data/resource';
import { canSign } from './access';

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What guests may currently see, mirroring lib/lifecycle.ts. Duplicated rather
 * than imported because Amplify functions take no cross-bundle imports; the
 * rule is simple and its inputs are on the row.
 */
function guestResolutionOf(item: Record<string, { S?: string; BOOL?: boolean }>): 'full' | 'small' | 'none' {
  const windowEnd = item.uploadWindowEndsAt?.S;
  const accessEnd = item.accessExpiresAt?.S;
  const now = Date.now();
  if (accessEnd && now > new Date(accessEnd).getTime()) return 'none';
  if (windowEnd && now > new Date(windowEnd).getTime()) return 'small';
  return 'full';
}

type Handler = Schema['mediaUrl']['functionHandler'];

export const handler: Handler = async (event) => {
  const client = r2();
  // Not configured, or configured badly: say so plainly and let the caller use
  // S3. This is the default, and it is why merging never changed behaviour.
  if (!client) return { url: null, reason: 'r2-not-configured' };

  const eventId = (event.arguments?.eventId ?? '').toString();
  const key = (event.arguments?.key ?? '').toString();

  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  ).catch(() => null);
  if (!found?.Item) return { url: null, reason: 'not-available' };

  const decision = canSign({
    eventId,
    key,
    event: {
      owner: found.Item.owner?.S ?? '',
      guestDownloadsBlocked: found.Item.guestDownloadsBlocked?.BOOL === true,
      guestResolution: guestResolutionOf(found.Item),
    },
    caller: event.identity as { sub?: string | null; groups?: string[] | null } | undefined,
  });
  if (!decision.allowed) return { url: null, reason: 'not-available' };

  // The object may not be in R2: nothing was backfilled, so anything uploaded
  // before the mirror went live lives only in S3, and a mirror failure leaves a
  // newer one there too. A HEAD is one cheap Class B operation and turns a
  // broken image into a clean fall back to S3.
  const exists = await client
    .send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
    .then(() => true)
    .catch(() => false);
  if (!exists) return { url: null, reason: 'not-mirrored' };

  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
      { expiresIn: URL_TTL_SECONDS },
    );
    return { url, reason: null };
  } catch (error) {
    console.error('Could not sign an R2 URL (falling back to S3)', {
      at: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return { url: null, reason: 'sign-failed' };
  }
};
