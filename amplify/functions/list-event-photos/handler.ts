import { DynamoDBClient, GetItemCommand, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import {
  audienceAllows,
  galleryAudienceOf,
  isHostOrAdmin,
  isVisibleTo,
  uploaderIdOf,
  type GalleryAudience,
} from './visibility';

const dynamo = new DynamoDBClient({});
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME ?? '';
const SHARE_TABLE = process.env.DOWNLOAD_SHARE_TABLE_NAME ?? '';

interface EventFacts {
  takenDown: boolean;
  owner: string;
  audience: GalleryAudience;
}

/**
 * What this listing needs from the event: whether an admin closed it, who owns
 * it, and who the host lets see the gallery. One small GetItem per call.
 *
 * A failed read answers "open, everyone" — the same outcome as before either
 * setting existed — and media-url refuses to sign a closed event's files
 * regardless.
 */
async function eventFacts(eventId: string): Promise<EventFacts> {
  const fallback: EventFacts = { takenDown: false, owner: '', audience: 'everyone' };
  if (!EVENT_TABLE) return fallback;
  const found = await dynamo
    .send(
      new GetItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        ProjectionExpression: 'takenDownAt, #owner, galleryAudience',
        ExpressionAttributeNames: { '#owner': 'owner' },
      }),
    )
    .catch(() => null);
  if (!found?.Item) return fallback;
  return {
    takenDown: Boolean(found.Item.takenDownAt?.S),
    owner: found.Item.owner?.S ?? '',
    audience: galleryAudienceOf(found.Item.galleryAudience?.S),
  };
}

/**
 * The photo ids in a host's download share, when it is for this event and
 * has not expired; otherwise null.
 *
 * A share is the host choosing particular photos for particular people, so it
 * is honoured whatever the gallery setting — a host who keeps the gallery to
 * themselves and then sends a share link meant it to work.
 */
async function sharedPhotoIds(shareId: string, eventId: string): Promise<Set<string> | null> {
  if (!SHARE_TABLE || !shareId) return null;
  const found = await dynamo
    .send(new GetItemCommand({ TableName: SHARE_TABLE, Key: { id: { S: shareId } } }))
    .catch(() => null);
  const item = found?.Item;
  if (!item || item.eventId?.S !== eventId) return null;
  const expires = item.expiresAt?.S ? Date.parse(item.expiresAt.S) : NaN;
  if (Number.isFinite(expires) && expires <= Date.now()) return null;
  try {
    const ids = JSON.parse(item.photoIdsJson?.S ?? '[]');
    return Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === 'string')) : null;
  } catch {
    return null;
  }
}

/**
 * The secondary index on Photo.eventId, as Amplify names it.
 *
 * Generated from `.secondaryIndexes((index) => [index('eventId')])` in
 * amplify/data/resource.ts. Hard-coded here because a Lambda cannot read the
 * schema, and asserted against that declaration by a test — if the index is
 * ever renamed or removed, the guard fails rather than every gallery.
 */
const PHOTOS_BY_EVENT_INDEX = 'photosByEventId';

type PhotoItem = Record<string, { S?: string; BOOL?: boolean }>;

/**
 * Every photo on one event.
 *
 * A Query against the eventId index, not a Scan of the whole table. This was a
 * Scan with a filter — it read every photo in SharePix to return one event's,
 * on the guest hot path, on every gallery open and every slideshow poll. Its
 * own comment said "fine at pilot scale", and the index it needed already
 * existed. Read cost was proportional to total photos stored multiplied by
 * views, which is the shape that stops being affordable quietly.
 *
 * Both forms page to the end. Truncating here would silently drop photos from
 * a gallery, which is worse than being slow.
 *
 * The Scan is kept only as a fallback for the one failure a Query has and a
 * Scan does not: the index being missing or renamed. That would otherwise take
 * every gallery down at once, and a guest looking at a wedding should not be
 * the one who finds out. It logs loudly, because a fallback nobody notices is
 * a Scan that came back permanently.
 */
async function photosForEvent(eventId: string): Promise<PhotoItem[]> {
  const items: PhotoItem[] = [];
  let startKey: Record<string, AttributeValue> | undefined;

  try {
    do {
      const result = await dynamo.send(
        new QueryCommand({
          TableName: PHOTO_TABLE,
          IndexName: PHOTOS_BY_EVENT_INDEX,
          KeyConditionExpression: '#eventId = :eventId',
          ExpressionAttributeNames: { '#eventId': 'eventId' },
          ExpressionAttributeValues: { ':eventId': { S: eventId } },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of result.Items ?? []) items.push(item as PhotoItem);
      startKey = result.LastEvaluatedKey;
    } while (startKey);
    return items;
  } catch (error) {
    console.error('Falling back to a full table scan; the eventId index did not answer', {
      at: new Date().toISOString(),
      index: PHOTOS_BY_EVENT_INDEX,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Anything already collected before the failure is discarded rather than
  // merged: a partial page plus a full scan would list some photos twice.
  const scanned: PhotoItem[] = [];
  let scanKey: Record<string, AttributeValue> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: PHOTO_TABLE,
        FilterExpression: '#eventId = :eventId',
        ExpressionAttributeNames: { '#eventId': 'eventId' },
        ExpressionAttributeValues: { ':eventId': { S: eventId } },
        ExclusiveStartKey: scanKey,
      }),
    );
    for (const item of result.Items ?? []) scanned.push(item as PhotoItem);
    scanKey = result.LastEvaluatedKey;
  } while (scanKey);
  return scanned;
}

type Handler = Schema['listEventPhotos']['functionHandler'];

export const handler: Handler = async (event) => {
  const eventId = event.arguments.eventId;
  if (!eventId) return [];

  const identity = event.identity as unknown as {
    sub?: string;
    cognitoIdentityId?: string;
    groups?: string[] | null;
  } | null;

  const facts = await eventFacts(eventId);
  // A closed event lists nothing to anyone but an admin.
  if (!(identity?.groups ?? []).includes('ADMINS') && facts.takenDown) return [];

  // The host's gallery setting. The host and admins see everything; a share
  // link sees exactly what the host put in it; everyone else sees what the
  // setting allows.
  const privileged = isHostOrAdmin(identity, facts.owner);
  const shared = privileged ? null : await sharedPhotoIds(event.arguments.shareId ?? '', eventId);
  const callerId = uploaderIdOf(identity);
  const audienceFilter = (item: PhotoItem) => {
    if (privileged) return true;
    if (shared) return shared.has(item.id?.S ?? '');
    return audienceAllows(
      facts.audience,
      { uploaderId: item.uploaderId?.S, uploadedByUserId: item.uploadedByUserId?.S },
      callerId,
    );
  };

  // Nothing to read for a guest of a host-only gallery.
  if (!privileged && !shared && facts.audience === 'host') return [];

  const items = await photosForEvent(eventId);

  // This query serves guests — the public gallery and the live slideshow — so it
  // is where content screening and video visibility are enforced. A photo held
  // for review is withheld here; the host reads the Photo model directly (owner
  // auth) and still sees everything, which is how flagged photos stay
  // reviewable and how the host keeps every video.
  return items
    .filter((item) => item.approved?.BOOL !== false)
    .filter((item) => item.moderationStatus?.S !== 'flagged')
    .filter((item) =>
      isVisibleTo({ s3Key: item.s3Key?.S, eventOwner: item.eventOwner?.S }, identity),
    )
    .filter(audienceFilter)
    .map((item) => ({
      id: item.id?.S ?? '',
      eventId: item.eventId?.S ?? '',
      s3Key: item.s3Key?.S ?? '',
      previewS3Key: item.previewS3Key?.S ?? null,
      thumbS3Key: item.thumbS3Key?.S ?? null,
      uploadedBy: item.uploadedBy?.S ?? null,
      uploadedByUserId: item.uploadedByUserId?.S ?? null,
      approved: item.approved?.BOOL ?? true,
      eventOwner: item.eventOwner?.S ?? null,
      contentHash: item.contentHash?.S ?? null,
      momentId: item.momentId?.S ?? null,
      challengeId: item.challengeId?.S ?? null,
      createdAt: item.createdAt?.S ?? null,
    }));
};
