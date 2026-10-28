import {
  DynamoDBClient,
  GetItemCommand,
  BatchGetItemCommand,
  QueryCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Schema } from '../../data/resource';
import {
  MAX_KEYS_PER_REQUEST,
  canSign,
  dedupeKeys,
  eventIdOfKey,
  photoStemOf,
  visibleStemsAndIds,
  isEventPhotoKey,
  isHostOrAdmin,
  isProKey,
  proUploadIdOf,
  variantOf,
} from './access';
import {
  galleryAudienceOf,
  galleryGateFor,
  uploaderIdOf,
  type PhotoRowFacts,
} from './visibility';
import { linkKeyMatches, linkRequired, shareIsCurrent, sharingPaused, type SharingFacts } from './galleryGate';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const LINK_TABLE = process.env.GALLERY_LINK_TABLE_NAME ?? '';
const SHARE_TABLE = process.env.DOWNLOAD_SHARE_TABLE_NAME ?? '';
const REVIEW_TABLE = process.env.REVIEW_TABLE_NAME ?? '';
const PHOTO_BUCKET = process.env.PHOTO_BUCKET_NAME ?? '';

const s3 = new S3Client({});

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
  const none = () => keys.map((key) => ({ key, url: null, fallbackUrl: null }));

  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  if (!found?.Item) return none();

  // One row read for the whole batch — the access rules are per-key but the
  // event state they read is not.
  const eventState = {
    owner: found.Item.owner?.S ?? '',
    guestDownloadsBlocked: found.Item.guestDownloadsBlocked?.BOOL === true,
    guestResolution: guestResolutionOf(found.Item),
    takenDown: Boolean(found.Item.takenDownAt?.S),
  };
  const caller = event.identity as {
    sub?: string | null;
    cognitoIdentityId?: string | null;
    groups?: string[] | null;
  } | undefined;
  const host = isHostOrAdmin(caller, eventState.owner);
  const isAdmin = (caller?.groups ?? []).includes('ADMINS');

  // A closed event signs nothing for anyone but an admin, whatever else is true.
  if (eventState.takenDown && !isAdmin) return none();

  const audience = galleryAudienceOf(found.Item.galleryAudience?.S);
  const args = event.arguments as {
    linkKey?: string | null;
    shareId?: string | null;
    reviewToken?: string | null;
  };

  const sharing: SharingFacts = {
    sharingPaused: found.Item.sharingPaused?.BOOL === true,
    galleryLinkSet: found.Item.galleryLinkSet?.BOOL === true,
    linkRotatedAt: found.Item.linkRotatedAt?.S ?? null,
  };
  const paused = sharingPaused(sharing);

  // A host's download share, or a moderation review link: two ways a caller
  // holds a credential for particular photos rather than for the gallery. A
  // share stops while sharing is paused and once the QR code is replaced.
  const shared = host || paused ? null : await sharedPhotoIds(args.shareId ?? '', eventId, sharing);
  const reviewed = host ? null : await reviewedStem(args.reviewToken ?? '', eventId);

  const needsKey = linkRequired(sharing);
  const gate = galleryGateFor({
    privileged: host,
    shared: shared !== null,
    paused,
    viewBlocked: found.Item.guestViewBlocked?.BOOL === true,
    audience,
    linkRequired: needsKey,
    keyValid: needsKey && !host && !shared ? await keyIsValid(eventId, args.linkKey ?? '') : false,
  });

  // The guest allow-list: the photos this caller may see right now, by the one
  // rule the gallery listing uses. Not read for the host, who may fetch
  // anything of their own event, nor for a closed gate, where nothing is signed.
  const visible =
    !host && gate === 'open' && keys.some((key) => isEventPhotoKey(key) || isProKey(key))
      ? await guestVisible(eventId, {
          identity: caller ?? null,
          audience,
          callerId: uploaderIdOf(caller ?? null),
          privileged: false,
          shared,
          owner: eventState.owner,
        })
      : null;

  // Which professional photos in this batch a guest may actually see: row is
  // visible AND its publish status is `published`. See publishedProIds.
  const publishedPro =
    gate === 'open' || host ? await publishedProIds(keys) : new Set<string>();

  const r2Client = r2();

  return Promise.all(
    keys.map(async (key) => {
      const refused = { key, url: null, fallbackUrl: null };

      let allowed = false;
      if (host) {
        allowed = canSign({ eventId, key, event: eventState, caller }).allowed;
      } else if (reviewed !== null && photoStemOf(key) === reviewed && photoStemOf(key) !== '') {
        // The reviewer sees the one photo their link is about, flagged or not,
        // and nothing else. Resolution rules do not apply: they are deciding
        // whether it may be shown at all.
        allowed = eventIdOfKey(key) === eventId;
      } else if (variantOf(key) === 'cover') {
        // The masthead the host chose: not one of the event's photos, so the
        // gallery settings do not hide it. Closed event and expired access still do.
        allowed = canSign({ eventId, key, event: eventState, caller }).allowed;
      } else if (gate === 'open') {
        allowed = canSign({ eventId, key, event: eventState, caller }).allowed;
        if (allowed && isProKey(key)) {
          const id = proUploadIdOf(key);
          allowed = publishedPro.has(id) && (visible?.ids.has(id) ?? false);
        } else if (allowed) {
          allowed = isEventPhotoKey(key) && (visible?.stems.has(photoStemOf(key)) ?? false);
        }
      }
      if (!allowed) return refused;
      // The host reaches their own event's professional previews the same way
      // a guest does, and is gated on publish status the same way.
      if (host && isProKey(key) && !publishedPro.has(proUploadIdOf(key))) return refused;

      // R2 where it can serve the object, S3 behind it. S3 is signed here with
      // this function's own role: guests have no storage read of their own on
      // events/* any more, so this is the only way an event photo is read.
      const [url, fallbackUrl] = await Promise.all([
        r2Client ? signR2(r2Client, key) : Promise.resolve(null),
        key.startsWith('events/') ? signS3(key) : Promise.resolve(null),
      ]);
      return { key, url, fallbackUrl };
    }),
  );
};

async function signR2(client: S3Client, key: string): Promise<string | null> {
  try {
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
      { expiresIn: URL_TTL_SECONDS },
    );
  } catch (error) {
    console.error('Could not sign an R2 URL', {
      at: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function signS3(key: string): Promise<string | null> {
  if (!PHOTO_BUCKET) return null;
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: PHOTO_BUCKET, Key: key }), {
      expiresIn: URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Could not sign an S3 URL', {
      at: new Date().toISOString(),
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The event's link key lives in a table guests cannot read. Fails closed. */
async function keyIsValid(eventId: string, key: string): Promise<boolean> {
  if (!LINK_TABLE || !key) return false;
  const found = await dynamo
    .send(
      new GetItemCommand({
        TableName: LINK_TABLE,
        Key: { id: { S: eventId } },
        ProjectionExpression: 'linkKey',
      }),
    )
    .catch(() => null);
  return linkKeyMatches(found?.Item?.linkKey?.S, key);
}

/** A download share's photo ids when it is this event's and unexpired, else null. */
async function sharedPhotoIds(
  shareId: string,
  eventId: string,
  sharing: SharingFacts,
): Promise<Set<string> | null> {
  if (!shareId || !SHARE_TABLE) return null;
  const found = await dynamo
    .send(
      new GetItemCommand({
        TableName: SHARE_TABLE,
        Key: { id: { S: shareId } },
        ProjectionExpression: 'eventId, expiresAt, photoIdsJson, createdAt',
      }),
    )
    .catch(() => null);
  const item = found?.Item;
  if (!item || item.eventId?.S !== eventId) return null;
  if (!shareIsCurrent(item.createdAt?.S, sharing)) return null;
  const expires = item.expiresAt?.S;
  if (expires && Date.now() > new Date(expires).getTime()) return null;
  try {
    const ids = JSON.parse(item.photoIdsJson?.S ?? '[]');
    return Array.isArray(ids) ? new Set(ids.filter((id): id is string => typeof id === 'string')) : null;
  } catch {
    return null;
  }
}

/**
 * The photo stem a moderation review link is about, when the link is real, for
 * this event and unexpired. The token is the credential, as it is for the
 * review page itself.
 */
async function reviewedStem(token: string, eventId: string): Promise<string | null> {
  if (!token || !REVIEW_TABLE) return null;
  const found = await dynamo
    .send(new GetItemCommand({ TableName: REVIEW_TABLE, Key: { token: { S: token } } }))
    .catch(() => null);
  const item = found?.Item;
  if (!item || item.eventId?.S !== eventId) return null;
  const expires = item.expiresAt?.S;
  if (expires && Date.now() > new Date(expires).getTime()) return null;
  const stem = photoStemOf(item.photoS3Key?.S ?? '');
  return stem || null;
}

/**
 * The upload ids in this batch whose photo row says `published`.
 *
 * Batched because a gallery asks for hundreds of keys at once and a read per
 * key would make the professional path quadratically slower than the guest
 * one. DynamoDB caps a BatchGetItem at 100 items, hence the chunking.
 *
 * Fails closed: a read that errors contributes nothing to the set, so those
 * photos are not signed. Showing a photographer's unreviewed work because a
 * table read timed out is the one outcome worth being slow or blank over.
 */
async function publishedProIds(keys: string[]): Promise<Set<string>> {
  const ids = [...new Set(keys.filter(isProKey).map(proUploadIdOf).filter(Boolean))];
  const published = new Set<string>();
  if (ids.length === 0 || !PHOTO_TABLE) return published;

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const result = await dynamo
      .send(
        new BatchGetItemCommand({
          RequestItems: {
            [PHOTO_TABLE]: {
              Keys: chunk.map((id) => ({ id: { S: id } })),
              ProjectionExpression: 'id, publishStatus',
            },
          },
        }),
      )
      .catch(() => null);
    for (const row of result?.Responses?.[PHOTO_TABLE] ?? []) {
      if (row.publishStatus?.S === 'published' && row.id?.S) published.add(row.id.S);
    }
  }
  return published;
}

const PHOTOS_BY_EVENT_INDEX = 'photosByEventId';

/**
 * The stems and ids of this event's photos the caller may see. Fails closed: if
 * the read fails, nothing is visible and no guest photo is signed.
 */
async function guestVisible(
  eventId: string,
  ctx: Omit<Parameters<typeof visibleStemsAndIds>[1], 'identity'> & {
    identity: unknown;
    owner: string;
  },
): Promise<{ stems: Set<string>; ids: Set<string> }> {
  const empty = { stems: new Set<string>(), ids: new Set<string>() };
  if (!PHOTO_TABLE) return empty;
  const rows: PhotoRowFacts[] = [];
  let startKey: Record<string, AttributeValue> | undefined;
  try {
    do {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: PHOTO_TABLE,
          IndexName: PHOTOS_BY_EVENT_INDEX,
          KeyConditionExpression: '#eventId = :eventId',
          ProjectionExpression:
            'id, s3Key, previewS3Key, thumbS3Key, approved, moderationStatus, eventOwner, boothMatch, publishStatus, boothDivider, boothSegment, uploaderId, uploadedByUserId',
          ExpressionAttributeNames: { '#eventId': 'eventId' },
          ExpressionAttributeValues: { ':eventId': { S: eventId } },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of result.Items ?? []) {
        rows.push({
          id: item.id?.S,
          s3Key: item.s3Key?.S,
          previewS3Key: item.previewS3Key?.S,
          thumbS3Key: item.thumbS3Key?.S,
          approved: item.approved?.BOOL,
          moderationStatus: item.moderationStatus?.S,
          eventOwner: item.eventOwner?.S,
          boothMatch: item.boothMatch?.S,
          publishStatus: item.publishStatus?.S,
          boothDivider: item.boothDivider?.BOOL,
          boothSegment: item.boothSegment?.S,
          uploaderId: item.uploaderId?.S,
          uploadedByUserId: item.uploadedByUserId?.S,
        });
      }
      startKey = result.LastEvaluatedKey;
    } while (startKey);
  } catch (error) {
    console.error('Could not read photo visibility; guest photo keys will not resolve', {
      at: new Date().toISOString(),
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return empty;
  }
  return visibleStemsAndIds(rows, ctx as Parameters<typeof visibleStemsAndIds>[1]);
}
