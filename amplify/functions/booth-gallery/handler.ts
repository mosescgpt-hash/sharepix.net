import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  LINK_TTL_SECONDS,
  MAX_GALLERY_PHOTOS,
  downloadName,
  inGallery,
  isGalleryKey,
} from './gallery';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;

/** Explicit in the schema so it cannot drift. */
const ATTENDEES_BY_GALLERY_KEY = 'boothAttendeesByGalleryKey';
const PHOTOS_BY_EVENT = 'photosByEventId';

const NOT_FOUND = {
  ok: false,
  message: 'This gallery link is not valid. Check the email it came in.',
  eventName: null,
  attendeeName: null,
  photos: [],
};

function recipientsOf(item: Record<string, AttributeValue>): string[] {
  const list = item.boothAttendeeIds?.L?.map((v) => v.S ?? '').filter(Boolean) ?? [];
  if (list.length > 0) return list;
  return item.boothAttendeeId?.S ? [item.boothAttendeeId.S] : [];
}

function sign(key: string, filename?: string): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
    }),
    { expiresIn: LINK_TTL_SECONDS },
  );
}

/**
 * One attendee's gallery, by the secret key in their email.
 *
 * Public, because the attendee has no account; the 192-bit key is the whole
 * authorization, and a wrong key gets the same answer as a missing one. Only
 * photos assigned to this person AND approved by the photographer are
 * returned, with links signed here — the pro/ prefix has no browser access
 * rule, so these links are the only way in.
 */
export const handler = async (event: { arguments: { key?: string | null } }) => {
  const key = String(event.arguments.key ?? '').trim();
  if (!isGalleryKey(key)) return NOT_FOUND;

  const found = await dynamo.send(
    new QueryCommand({
      TableName: ATTENDEE_TABLE,
      IndexName: ATTENDEES_BY_GALLERY_KEY,
      KeyConditionExpression: 'galleryKey = :key',
      ExpressionAttributeValues: { ':key': { S: key } },
      Limit: 2,
    }),
  );
  const attendee = found.Items?.[0];
  const attendeeId = attendee?.id?.S;
  const eventId = attendee?.eventId?.S;
  if (!attendeeId || !eventId) return NOT_FOUND;

  const ev = await dynamo.send(
    new GetItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      ProjectionExpression: 'id, #name, boothMode, takenDownAt',
      ExpressionAttributeNames: { '#name': 'name' },
    }),
  );
  if (!ev.Item || ev.Item.boothMode?.BOOL !== true || ev.Item.takenDownAt?.S) return NOT_FOUND;
  const eventName = ev.Item.name?.S ?? 'Your photos';

  const mine: Record<string, AttributeValue>[] = [];
  let start: Record<string, AttributeValue> | undefined;
  for (let page = 0; page < 50 && mine.length < MAX_GALLERY_PHOTOS; page += 1) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: PHOTO_TABLE,
        IndexName: PHOTOS_BY_EVENT,
        KeyConditionExpression: 'eventId = :event',
        FilterExpression: 'attribute_exists(boothMatch) AND publishStatus = :approved',
        ExpressionAttributeValues: { ':event': { S: eventId }, ':approved': { S: 'approved' } },
        ExclusiveStartKey: start,
      }),
    );
    for (const item of res.Items ?? []) {
      if (inGallery({ recipients: recipientsOf(item), publishStatus: item.publishStatus?.S ?? null }, attendeeId)) {
        mine.push(item);
      }
    }
    start = res.LastEvaluatedKey;
    if (!start) break;
  }
  mine.sort((a, b) => (a.capturedAt?.S ?? a.createdAt?.S ?? '').localeCompare(b.capturedAt?.S ?? b.createdAt?.S ?? ''));

  const photos = await Promise.all(
    mine.slice(0, MAX_GALLERY_PHOTOS).map(async (item, index) => {
      const preview = item.previewObjectKey?.S ?? item.s3Key?.S ?? '';
      const original = item.originalObjectKey?.S ?? '';
      // The content type names the file correctly (a HEIC stays a HEIC).
      const head = original
        ? await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: original })).catch(() => null)
        : null;
      return {
        id: item.id?.S ?? '',
        previewUrl: preview ? await sign(preview) : null,
        // No original (it failed to keep, or was cleaned up): the preview is
        // all there is, and the page says so rather than offering nothing.
        downloadUrl: head
          ? await sign(original, downloadName(eventName, index, head.ContentType ?? null))
          : null,
        capturedAt: item.capturedAt?.S ?? null,
      };
    }),
  );

  return {
    ok: true,
    message: photos.length === 0 ? 'No photos yet. You will get an email when they are ready.' : '',
    eventName,
    attendeeName: attendee.name?.S ?? null,
    photos,
  };
};
