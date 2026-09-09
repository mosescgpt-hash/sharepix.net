import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { isVisibleTo } from './visibility';

const dynamo = new DynamoDBClient({});
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;

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
    groups?: string[] | null;
  } | null;

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
      createdAt: item.createdAt?.S ?? null,
    }));
};
