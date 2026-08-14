// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  RekognitionClient,
  DetectModerationLabelsCommand,
} from '@aws-sdk/client-rekognition';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { buildAlertEmail } from './alert-email';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { evaluateModeration, MODERATION_CONFIDENCE_THRESHOLD } from './moderation';

const dynamo = new DynamoDBClient({});
const rekognition = new RekognitionClient({});
const s3 = new S3Client({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET_NAME = process.env.BUCKET_NAME as string;
const REVIEW_TABLE = process.env.REVIEW_TABLE_NAME as string;

/** How long a review link stays usable before the host must use the dashboard. */
const REVIEW_TTL_DAYS = 14;

/** Videos aren't screened here — image moderation only covers stills. */
const VIDEO_KEY = /\.(mp4|mov|webm|m4v|3gp)$/i;

/**
 * Screen an uploaded still for explicit content. Runs before the photo record is
 * written, so the verdict is stored with the photo and there's no window where
 * an unscreened image is already visible.
 *
 * Screening failures do NOT block the upload: an outage would otherwise break
 * every guest's gallery. The photo is recorded as 'skipped' and the error is
 * logged, which trips the function's CloudWatch error alarm so the operator
 * finds out. See docs/moderation.md for the trade-off.
 */
async function screenPhoto(
  s3Key: string,
): Promise<{ status: string; reasons: string[] }> {
  if (VIDEO_KEY.test(s3Key)) return { status: 'skipped', reasons: [] };
  if (!BUCKET_NAME) return { status: 'skipped', reasons: [] };

  try {
    const result = await rekognition.send(
      new DetectModerationLabelsCommand({
        Image: { S3Object: { Bucket: BUCKET_NAME, Name: s3Key } },
        MinConfidence: MODERATION_CONFIDENCE_THRESHOLD,
      }),
    );
    const { flagged, reasons } = evaluateModeration(result.ModerationLabels);
    return { status: flagged ? 'flagged' : 'ok', reasons };
  } catch (error) {
    console.error('Content screening failed; recording photo as unscreened', {
      at: new Date().toISOString(),
      s3Key,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'skipped', reasons: [] };
  }
}

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

/**
 * Open a review for a photo the screener held back, so the host can decide on it
 * from a link without signing in. The token is the credential, so it comes from
 * the CSPRNG at full width rather than a guessable id.
 *
 * Best-effort: a photo is already hidden by its own flagged status, so failing
 * to create the review link must not fail the guest's upload. The host can
 * still review it in the dashboard.
 */
async function openReview(input: {
  photoId: string;
  eventId: string;
  eventName: string;
  s3Key: string;
  reasons: string[];
}): Promise<string | null> {
  if (!REVIEW_TABLE) return null;
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REVIEW_TTL_DAYS * 24 * 60 * 60 * 1000);
  const item: Record<string, AttributeValue> = {
    token: { S: token },
    __typename: { S: 'ModerationReview' },
    photoId: { S: input.photoId },
    eventId: { S: input.eventId },
    photoS3Key: { S: input.s3Key },
    status: { S: 'pending' },
    expiresAt: { S: expiresAt.toISOString() },
    createdAt: { S: now.toISOString() },
    updatedAt: { S: now.toISOString() },
  };
  if (input.eventName) item.eventName = { S: input.eventName };
  if (input.reasons.length > 0) item.reasons = { S: input.reasons.join(', ') };

  try {
    await dynamo.send(new PutItemCommand({ TableName: REVIEW_TABLE, Item: item }));
    return token;
  } catch (error) {
    console.error('Could not open a moderation review', {
      at: new Date().toISOString(),
      photoId: input.photoId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Email the host that a photo is waiting, with the preview embedded and buttons
 * that open the review link.
 *
 * Best-effort and only ever runs for a flagged photo — a rare path — so the
 * cost of fetching the preview and building the message never lands on a normal
 * upload. A send failure leaves the photo hidden and reviewable in the
 * dashboard, which is the safe outcome.
 */
async function sendAlertEmail(input: {
  to: string;
  eventName: string;
  reasons: string[];
  token: string;
  previewKey: string;
}): Promise<void> {
  const from = process.env.ALERT_FROM_ADDRESS;
  if (!from || !input.to) return;

  const appUrl = process.env.APP_URL ?? 'https://www.sharepix.net';
  const reviewUrl = `${appUrl}/review/${input.token}`;

  // Attach the preview rather than hotlinking it: our image URLs are
  // short-lived signed links and would be broken by the time the host opens the
  // message.
  let image: { bytes: Uint8Array; contentType: string } | undefined;
  try {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET_NAME, Key: input.previewKey }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Buffer>) chunks.push(chunk);
    const bytes = new Uint8Array(Buffer.concat(chunks));
    // Keep the message comfortably inside SES's size limit.
    if (bytes.byteLength <= 4 * 1024 * 1024) {
      image = { bytes, contentType: object.ContentType ?? 'image/jpeg' };
    }
  } catch {
    // Send without the preview; the review link still works.
  }

  try {
    await ses.send(
      new SendEmailCommand({
        Content: {
          Raw: {
            Data: Buffer.from(
              buildAlertEmail({
                from,
                to: input.to,
                eventName: input.eventName,
                reasons: input.reasons.join(', '),
                reviewUrl,
                image,
              }),
            ),
          },
        },
      }),
    );
  } catch (error) {
    console.error('Could not send the moderation alert email', {
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

  // Defense-in-depth on the (client-built) keys: reject traversal sequences,
  // unsafe characters, and known-dangerous/executable file types — so a crafted
  // request can't register an .svg/.html/.js/.exe object or escape the event
  // folder even though the prefix passed above. Legitimate image/video clients
  // never send these, so this only trips bypass attempts.
  const SAFE_KEY = /^[a-zA-Z0-9._/-]+$/;
  const DANGEROUS_EXT =
    /\.(svg|svgz|html|htm|xhtml|xml|js|mjs|exe|dll|bat|cmd|com|msi|scr|sh|ps1|vbs|php|phtml|jsp|asp|aspx|cgi|pl|py|rb|zip|rar|7z|tar|gz|tgz|htaccess)$/i;
  const badKey = [s3Key, previewS3Key, thumbS3Key]
    .filter(Boolean)
    .find((k) => k.includes('..') || !SAFE_KEY.test(k) || DANGEROUS_EXT.test(k));
  if (badKey) {
    const identity = event.identity as { sub?: string; sourceIp?: string[] } | undefined;
    // Log for review without leaking bucket internals to the client.
    console.error('Rejected suspicious photo key', {
      at: new Date().toISOString(),
      eventId,
      key: badKey,
      userId: uploadedByUserId ?? identity?.sub ?? null,
      sourceIp: identity?.sourceIp ?? null,
    });
    throw new Error('That file type or name is not allowed.');
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

  // A host can turn video off — automated screening covers stills but not
  // video, so this is how they keep an event to screened media only. Checked
  // server-side because the upload form's file picker is only a convenience.
  if (ev.videoUploadsEnabled?.BOOL === false && VIDEO_KEY.test(s3Key)) {
    throw new Error('This event accepts photos only.');
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

  // Screen the image before the record exists, so a flagged photo is never
  // briefly visible to guests. A host who has chosen to allow everything skips
  // screening altogether — nothing is held back, and no Rekognition call is
  // made or paid for.
  const screening =
    (ev.moderationMode?.S ?? 'review') === 'allow_all'
      ? { status: 'skipped', reasons: [] as string[] }
      : await screenPhoto(s3Key);

  const now = new Date().toISOString();
  const item: Record<string, AttributeValue> = {
    id: { S: id },
    __typename: { S: 'Photo' },
    eventId: { S: eventId },
    s3Key: { S: s3Key },
    approved: { BOOL: true },
    eventOwner: { S: eventOwner },
    moderationStatus: { S: screening.status },
    createdAt: { S: now },
    updatedAt: { S: now },
  };
  if (screening.reasons.length > 0) {
    item.moderationReasons = { S: screening.reasons.join(', ') };
  }
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

  // A held-back photo gets a review link so the host can decide on it without
  // signing in. Only after the record exists, so the link always resolves.
  if (screening.status === 'flagged') {
    const eventName = ev.name?.S ?? '';
    const token = await openReview({
      photoId: id,
      eventId,
      eventName,
      s3Key,
      reasons: screening.reasons,
    });
    const alertEmail = ev.alertEmail?.S ?? '';
    if (token && alertEmail) {
      await sendAlertEmail({
        to: alertEmail,
        eventName,
        reasons: screening.reasons,
        token,
        // Prefer the smaller preview for the email; fall back to the original.
        previewKey: previewS3Key || s3Key,
      });
    }
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
