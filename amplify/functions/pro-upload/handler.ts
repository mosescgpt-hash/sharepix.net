import { randomUUID } from 'node:crypto';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Schema } from '../../data/resource';
import { connectionId, mayUploadToEvent } from './photographerAccess';
import { professionalKeys } from './professionalMedia';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});

const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const BUCKET = process.env.PHOTO_BUCKET_NAME as string;

/** Long enough to push a 60 MB file from a venue's wifi, short enough to matter. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

type Handler = Schema['requestProUploadSlot']['functionHandler'];

/**
 * Hand a photographer somewhere to put one photograph.
 *
 * ## What the caller does not get to choose
 *
 * The object key. It is built here from the event id and a fresh uuid, so a
 * caller cannot aim an upload at another event's prefix, at the previews
 * folder, or at a key that already holds somebody's photo. A presigned URL is
 * a capability — whatever it is signed for is what the holder can write — so
 * the only safe place to decide the key is here.
 *
 * ## Authorization
 *
 * The connection row, read by its composite id, and then re-checked against
 * the event and photographer this request is actually for. Reading a row by a
 * key built from the arguments and trusting what comes back is how a getItem
 * typo becomes cross-event access; `mayUploadToEvent` compares the row's own
 * fields to the request rather than assuming they match.
 *
 * The photographer's identity comes from the token, never from the body.
 */
export const handler: Handler = async (event) => {
  const sub = event.identity && 'sub' in event.identity ? String(event.identity.sub) : '';
  const eventId = String(event.arguments.eventId ?? '');
  if (!sub || !eventId) throw new Error('That event could not be found.');

  const found = await dynamo
    .send(
      new GetItemCommand({
        TableName: CONNECTION_TABLE,
        Key: { id: { S: connectionId(eventId, sub) } },
      }),
    )
    .catch(() => null);

  const row = found?.Item;
  const connection = row
    ? {
        eventId: row.eventId?.S ?? null,
        photographerId: row.photographerId?.S ?? null,
        status: row.status?.S ?? null,
      }
    : null;

  // One answer whether the event does not exist, the photographer was never
  // invited, or the invitation is still unaccepted. Anything more specific
  // would let somebody map which events exist and who shoots them.
  if (!mayUploadToEvent(connection, eventId, sub)) {
    throw new Error('That event could not be found.');
  }

  const uploadId = randomUUID();
  const keys = professionalKeys(eventId, uploadId);

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: keys.original,
      // Pinned so the signature does not cover an unbounded body. A caller
      // sending something else gets a signature mismatch from S3 rather than a
      // 400 MB surprise in the originals prefix.
      ContentType: String(event.arguments.contentType ?? 'application/octet-stream'),
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );

  return { uploadId, uploadUrl: url, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
};
