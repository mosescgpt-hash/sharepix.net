import {
  DynamoDBClient,
  GetItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET = process.env.BUCKET_NAME as string;

type Handler = Schema['deleteEventPhoto']['functionHandler'];

/** The Amplify `owner`/`eventOwner` string is `"<sub>::<loginId>"`. */
function ownerSub(eventOwner: string): string {
  return eventOwner.split('::')[0];
}

export const handler: Handler = async (event) => {
  const photoId = event.arguments.photoId;
  const identity = event.identity as unknown as {
    sub?: string;
    groups?: string[] | null;
  } | null;
  const sub = identity?.sub;
  if (!sub) {
    throw new Error('Sign in to delete photos.');
  }

  const found = await dynamo.send(
    new GetItemCommand({ TableName: TABLE, Key: { id: { S: photoId } } }),
  );
  const item = found.Item;
  // Already gone — treat as success so repeated deletes are harmless.
  if (!item) {
    return { success: true, message: 'Photo already removed.' };
  }

  const eventOwner = item.eventOwner?.S ?? '';
  const isOwner = eventOwner !== '' && ownerSub(eventOwner) === sub;
  const isAdmin = (identity?.groups ?? []).includes('ADMINS');
  if (!isOwner && !isAdmin) {
    throw new Error('Only the event host can delete this photo.');
  }

  const keys = [item.s3Key?.S, item.previewS3Key?.S].filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  );
  await Promise.all(
    keys.map((Key) =>
      s3
        .send(new DeleteObjectCommand({ Bucket: BUCKET, Key }))
        .catch(() => undefined),
    ),
  );

  await dynamo.send(
    new DeleteItemCommand({ TableName: TABLE, Key: { id: { S: photoId } } }),
  );

  return { success: true, message: 'Photo deleted.' };
};
