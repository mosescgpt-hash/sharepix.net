// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;

type Handler = Schema['listEventPhotos']['functionHandler'];

export const handler: Handler = async (event) => {
  const eventId = event.arguments.eventId;
  if (!eventId) return [];

  // Read every photo for this one event. Scan + filter is fine at pilot scale;
  // it can move to the indexed query as the table grows.
  const items: Record<string, { S?: string; BOOL?: boolean }>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: PHOTO_TABLE,
        FilterExpression: '#eventId = :eventId',
        ExpressionAttributeNames: { '#eventId': 'eventId' },
        ExpressionAttributeValues: { ':eventId': { S: eventId } },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of result.Items ?? []) items.push(item);
    startKey = result.LastEvaluatedKey;
  } while (startKey);

  // This query serves guests — the public gallery and the live slideshow — so it
  // is where content screening is enforced. A photo held for review is withheld
  // here; the host reads the Photo model directly (owner auth) and still sees
  // everything, which is how flagged photos stay reviewable.
  return items
    .filter((item) => item.approved?.BOOL !== false)
    .filter((item) => item.moderationStatus?.S !== 'flagged')
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
      createdAt: item.createdAt?.S ?? null,
    }));
};
