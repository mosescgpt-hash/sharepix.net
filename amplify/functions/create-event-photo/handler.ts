// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
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

export const handler: Handler = async (event) => {
  const { eventId, s3Key, previewS3Key, uploadedBy, uploadedByUserId } = event.arguments;

  // The photo's files must live under this event's own storage prefix. This
  // stops a crafted request from creating a record that points at another
  // event's files or an arbitrary object elsewhere in the bucket.
  const prefix = `events/${eventId}/`;
  if (!s3Key.startsWith(prefix) || (previewS3Key && !previewS3Key.startsWith(prefix))) {
    throw new Error('The photo path does not belong to this event.');
  }

  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  const ev = found.Item;
  if (!ev) {
    throw new Error('This event no longer exists or cannot accept uploads.');
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

  const now = new Date().toISOString();
  const id = randomUUID();
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
  if (uploadedBy) item.uploadedBy = { S: uploadedBy };
  if (uploadedByUserId) item.uploadedByUserId = { S: uploadedByUserId };

  try {
    await dynamo.send(new PutItemCommand({ TableName: PHOTO_TABLE, Item: item }));
  } catch (error) {
    // Give the reserved slot back if the record couldn't be written.
    await dynamo
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
    throw error;
  }

  return {
    id,
    eventId,
    s3Key,
    previewS3Key: previewS3Key ?? null,
    uploadedBy: uploadedBy ?? null,
    uploadedByUserId: uploadedByUserId ?? null,
    approved: true,
    eventOwner,
    createdAt: now,
  };
};
