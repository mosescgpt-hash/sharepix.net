// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { createHash, randomUUID } from 'node:crypto';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;

type Handler = Schema['createEventPhoto']['functionHandler'];

function toInt(value?: string): number | null {
  if (value === undefined) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Accept only a real SHA-256 hex digest; anything else is treated as absent. */
function normalizeHash(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null;
}

/**
 * The record id for a hashed upload, derived from the event and the file's
 * bytes. Two uploads of the same picture to the same event therefore compete
 * for one id, and DynamoDB's conditional write lets exactly one of them win —
 * no index scan, and no race between guests uploading at the same moment. The
 * client's browser-side check already skips most duplicates; this closes the
 * gap it can't (simultaneous uploads, or a request that bypasses the UI).
 */
function photoIdForContent(eventId: string, contentHash: string): string {
  const digest = createHash('sha256').update(`${eventId}:${contentHash}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}

function readPhoto(item: Record<string, AttributeValue>, duplicate: boolean) {
  return {
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
    duplicate,
    createdAt: item.createdAt?.S ?? null,
  };
}

async function fetchPhoto(id: string): Promise<Record<string, AttributeValue> | null> {
  const found = await dynamo.send(
    new GetItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: id } } }),
  );
  return found.Item ?? null;
}

export const handler: Handler = async (event) => {
  const {
    eventId,
    s3Key,
    previewS3Key,
    thumbS3Key,
    uploadedBy,
    uploadedByUserId,
  } = event.arguments;
  const contentHash = normalizeHash(event.arguments.contentHash);

  // The photo's files must live under this event's own storage prefix. This
  // stops a crafted request from creating a record that points at another
  // event's files or an arbitrary object elsewhere in the bucket.
  const prefix = `events/${eventId}/`;
  if (
    !s3Key.startsWith(prefix) ||
    (previewS3Key && !previewS3Key.startsWith(prefix)) ||
    (thumbS3Key && !thumbS3Key.startsWith(prefix))
  ) {
    throw new Error('The photo path does not belong to this event.');
  }

  // Cheap pre-check: if this event already holds these exact bytes, hand back the
  // record it already has. Nothing is counted and nothing is written, so a guest
  // (or a retry) re-sending the same photo can't eat into the event's limit.
  const id = contentHash ? photoIdForContent(eventId, contentHash) : randomUUID();
  if (contentHash) {
    const existing = await fetchPhoto(id);
    if (existing) return readPhoto(existing, true);
  }

  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  const ev = found.Item;
  if (!ev) {
    throw new Error('This event no longer exists or cannot accept uploads.');
  }

  // An event created but not yet paid for is inactive — reject uploads until
  // payment completes (the Stripe webhook flips `paid` to true). Missing `paid`
  // (older events) is treated as active.
  if (ev.paid?.BOOL === false) {
    throw new Error('This event is not active yet. Please complete payment first.');
  }

  // The host can close an event to stop new uploads while keeping the gallery
  // viewable. Enforce it here so a crafted request can't bypass the UI.
  if (ev.uploadsClosed?.BOOL === true) {
    throw new Error('This event is closed and is no longer accepting uploads.');
  }

  const eventOwner = ev.owner?.S ?? '';
  const photoLimit = toInt(ev.photoLimit?.N);
  const extraCredits = toInt(ev.extraPhotoCredits?.N) ?? 0;

  // Reserve a slot atomically. `photoLimit === null` means unlimited (Premium),
  // so the count still increments but never blocks. A missing photoCount is
  // treated as 0, so older events simply start counting from this upload.
  const effectiveLimit = photoLimit === null ? null : photoLimit + extraCredits;
  const update: {
    TableName: string;
    Key: Record<string, AttributeValue>;
    UpdateExpression: string;
    ExpressionAttributeValues: Record<string, AttributeValue>;
    ConditionExpression?: string;
  } = {
    TableName: EVENT_TABLE,
    Key: { id: { S: eventId } },
    UpdateExpression: 'ADD photoCount :one',
    ExpressionAttributeValues: { ':one': { N: '1' } },
  };
  if (effectiveLimit !== null) {
    update.ConditionExpression = 'attribute_not_exists(photoCount) OR photoCount < :limit';
    update.ExpressionAttributeValues[':limit'] = { N: String(effectiveLimit) };
  }

  try {
    await dynamo.send(new UpdateItemCommand(update));
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new Error('This event has reached its photo limit.');
    }
    throw error;
  }

  const releaseSlot = () =>
    dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: 'ADD photoCount :neg',
          ConditionExpression: 'attribute_exists(photoCount) AND photoCount > :zero',
          ExpressionAttributeValues: { ':neg': { N: '-1' }, ':zero': { N: '0' } },
        }),
      )
      .catch(() => undefined);

  const now = new Date().toISOString();
  const item: Record<string, AttributeValue> = {
    id: { S: id },
    __typename: { S: 'Photo' },
    eventId: { S: eventId },
    s3Key: { S: s3Key },
    approved: { BOOL: true },
    eventOwner: { S: eventOwner },
    createdAt: { S: now },
    updatedAt: { S: now },
  };
  if (previewS3Key) item.previewS3Key = { S: previewS3Key };
  if (thumbS3Key) item.thumbS3Key = { S: thumbS3Key };
  if (uploadedBy) item.uploadedBy = { S: uploadedBy };
  if (uploadedByUserId) item.uploadedByUserId = { S: uploadedByUserId };
  if (contentHash) item.contentHash = { S: contentHash };

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: PHOTO_TABLE,
        Item: item,
        // Only hashed uploads can collide on id, and losing that race means
        // another upload of the same bytes landed first.
        ...(contentHash ? { ConditionExpression: 'attribute_not_exists(id)' } : {}),
      }),
    );
  } catch (error) {
    // Give the reserved slot back if the record couldn't be written.
    await releaseSlot();

    // Lost the race for a content-derived id: the winner's record is the truth,
    // so return it as a duplicate instead of failing the guest's upload.
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      const winner = await fetchPhoto(id);
      if (winner) return readPhoto(winner, true);
    }
    throw error;
  }

  return {
    id,
    eventId,
    s3Key,
    previewS3Key: previewS3Key ?? null,
    thumbS3Key: thumbS3Key ?? null,
    uploadedBy: uploadedBy ?? null,
    uploadedByUserId: uploadedByUserId ?? null,
    approved: true,
    eventOwner,
    contentHash: contentHash ?? null,
    duplicate: false,
    createdAt: now,
  };
};
