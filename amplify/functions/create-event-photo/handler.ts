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
import {
  CONTRIBUTOR_MILESTONES,
  UPLOAD_MILESTONES,
  analyticsId,
  milestonesCrossed,
  type AnalyticsEventName,
} from './analytics';
import { evaluateModeration, MODERATION_CONFIDENCE_THRESHOLD } from './moderation';
import { uploadWindowClosed, UPLOAD_WINDOW_CLOSED_MESSAGE } from './uploadWindow';
import { contributorKey, contributorRowId, isSuccessfulEvent } from './successfulEvent';
import { assessUsage, fairUseConfig, windowExpired } from './fairUse';
import { entitledPhotoLimit, entitledVideoBytes, entitledVideoLimit } from './planLimits';

const dynamo = new DynamoDBClient({});
const rekognition = new RekognitionClient({});
const s3 = new S3Client({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME ?? '';
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
const BUCKET_NAME = process.env.BUCKET_NAME as string;
const REVIEW_TABLE = process.env.REVIEW_TABLE_NAME as string;
const MOMENT_TABLE = process.env.MOMENT_TABLE_NAME as string;
const CONTRIBUTOR_TABLE = process.env.CONTRIBUTOR_TABLE_NAME as string;

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

/**
 * Byte counters, which are stored as Float rather than Int.
 *
 * parseInt would silently truncate at the decimal point, and more importantly
 * these routinely exceed what a 32-bit int holds — an event past 2.1 GB is
 * ordinary, which is why the model field is a.float() in the first place.
 */
function toFloat(value?: string): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
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

/**
 * Record that this person has uploaded to this event, and if they had not
 * before, add one to the event's contributor count.
 *
 * The conditional put on `<eventId>#<key>` is what makes "distinct people"
 * cheap: it succeeds exactly once per person per event, so the count moves
 * exactly when it should, with no scanning and no race between two guests
 * uploading in the same second.
 *
 * Entirely best-effort. This runs after the photo is already stored, and a
 * participation metric is never worth failing an upload over — a guest at a
 * party would see their photo rejected because a counter did not move. A
 * failure here undercounts, is logged, and nothing else happens.
 *
 * Returns whether this was a newly seen contributor, for the caller's log.
 */
async function recordContributor(
  eventId: string,
  uploadedBy: string | null | undefined,
  nowISO: string,
): Promise<boolean> {
  // No table configured, or nothing that identifies a person. `contributorKey`
  // returns null for a blank name and for the legacy "Anonymous" that every
  // unnamed upload used to become — see lib/successfulEvent.ts for why that is
  // deliberately not counted as somebody.
  const key = contributorKey(uploadedBy);
  if (!CONTRIBUTOR_TABLE || !key) return false;

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: CONTRIBUTOR_TABLE,
        Item: {
          id: { S: contributorRowId(eventId, key) },
          __typename: { S: 'EventContributor' },
          eventId: { S: eventId },
          contributorKey: { S: key },
          firstUploadAt: { S: nowISO },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    // Already seen: the overwhelmingly common case after someone's first photo.
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return false;
    }
    console.error('Could not record a contributor', {
      at: nowISO,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  // New person. Bump the count on the event row, unconditionally — ADD creates
  // the attribute when it is missing, which is what makes events that predate
  // this simply start counting from their next upload.
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'ADD contributorCount :one',
        ExpressionAttributeValues: { ':one': { N: '1' } },
      }),
    );
  } catch (error) {
    // The contributor row exists but the count did not move, so this person
    // will never be counted. Logged loudly because it is silent otherwise, and
    // the row is the record that lets it be recomputed later.
    console.error('Recorded a contributor but could not increment the count', {
      at: nowISO,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
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
                replyTo: process.env.ALERT_REPLY_TO,
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

/**
 * Write one funnel event, once.
 *
 * The id is the dedupe rule — a milestone is keyed by name and event, so a
 * second write is a conditional-put failure rather than a second row. Failures
 * are swallowed on purpose: this is telemetry attached to an upload that has
 * already succeeded, and a photo somebody's guests are waiting for must not
 * depend on a counter.
 */
async function fireAnalytics(
  name: AnalyticsEventName,
  scopeId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (!ANALYTICS_TABLE) return;
  const now = new Date().toISOString();
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: ANALYTICS_TABLE,
        Item: {
          id: { S: analyticsId(name, scopeId, randomUUID()) },
          __typename: { S: 'AnalyticsEvent' },
          name: { S: name },
          scopeId: { S: scopeId },
          ...(detail ? { detailJson: { S: JSON.stringify(detail).slice(0, 500) } } : {}),
          occurredAt: { S: now },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return;
    console.error('Could not record a funnel event', {
      at: now,
      name,
      scopeId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The milestones this upload crossed.
 *
 * Only guest uploads count towards activation — the brief is explicit that a
 * host uploading to their own event is not the product working, and it is the
 * whole reason `first_guest_upload` exists rather than `first_upload`.
 */
async function recordUploadMilestones(facts: {
  eventId: string;
  isGuestUpload: boolean;
  before: { guestUploads: number; contributors: number };
  after: { guestUploads: number; contributors: number };
}): Promise<void> {
  if (!ANALYTICS_TABLE || !facts.isGuestUpload) return;
  const { eventId, before, after } = facts;

  await fireAnalytics('guest_upload_completed', eventId);

  if (before.guestUploads === 0 && after.guestUploads > 0) {
    await fireAnalytics('first_guest_upload', eventId);
  }
  if (before.contributors < 3 && after.contributors >= 3) {
    await fireAnalytics('third_unique_contributor', eventId);
  }

  // The Successful Event line, from the one definition the rest of the codebase
  // reads. Crossing it is what the whole funnel is pointed at.
  const wasSuccessful = isSuccessfulEvent({
    contributorCount: before.contributors,
    guestUploadCount: before.guestUploads,
  });
  const nowSuccessful = isSuccessfulEvent({
    contributorCount: after.contributors,
    guestUploadCount: after.guestUploads,
  });
  if (!wasSuccessful && nowSuccessful) {
    await fireAnalytics('successful_event', eventId);
  }

  for (const mark of milestonesCrossed(before.guestUploads, after.guestUploads, UPLOAD_MILESTONES)) {
    await fireAnalytics('upload_milestone', `${eventId}#${mark}`, { uploads: mark });
  }
  for (const mark of milestonesCrossed(before.contributors, after.contributors, CONTRIBUTOR_MILESTONES)) {
    await fireAnalytics('contributor_milestone', `${eventId}#${mark}`, { contributors: mark });
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
  // The predicate form of filter, because `.filter(Boolean)` does not narrow:
  // the keys are nullable, and inside the find they were being treated as
  // strings on trust. This is the check that stops a crafted request
  // registering an .svg or escaping the event folder, so it is the last place
  // to be reasoning about a value whose type nobody established.
  const badKey = [s3Key, previewS3Key, thumbS3Key]
    .filter((k): k is string => typeof k === 'string' && k.length > 0)
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

  // The upload window, enforced here rather than only in the guest UI. See
  // uploadWindow.ts for why that distinction is the whole point.
  if (uploadWindowClosed(ev.uploadWindowEndsAt?.S)) {
    throw new Error(UPLOAD_WINDOW_CLOSED_MESSAGE);
  }

  // A host can turn video off — automated screening covers stills but not
  // video, so this is how they keep an event to screened media only. Checked
  // server-side because the upload form's file picker is only a convenience.
  if (ev.videoUploadsEnabled?.BOOL === false && VIDEO_KEY.test(s3Key)) {
    throw new Error('This event accepts photos only.');
  }

  const eventOwner = ev.owner?.S ?? '';

  // Is this the host uploading to their own event?
  //
  // Taken from the caller's verified identity and the event's stored owner —
  // never from `uploadedByUserId`, which arrives in the request and is
  // therefore a claim. Getting this from the client would let anyone mark
  // their uploads as host uploads (or a host mark theirs as guest uploads) and
  // the participation numbers would measure nothing.
  //
  // Guests reach this mutation through the identity pool and have no `sub` at
  // all, so the check is simply: a verified sub that appears in the owner
  // string. Anyone else is a guest, which is the safe default — the failure
  // mode is counting a second signed-in admin as a guest, not the reverse.
  const callerSub = (event.identity as { sub?: string } | undefined)?.sub ?? '';
  const isHostUpload = Boolean(callerSub) && eventOwner.includes(callerSub);
  const isGuestUpload = !isHostUpload;

  const isVideo = VIDEO_KEY.test(s3Key);
  // The limits stamped on the row are a FLOOR, not a ceiling: an event gets the
  // more generous of what it was sold and what its plan includes today. Without
  // this, every event created before the $79 plan went unlimited stays capped
  // at the 3,000 it was stamped with, while the pricing page promises no cap.
  // entitledPhotoLimit can only ever raise a limit — see lib/planLimits.ts.
  const planRow = {
    tier: ev.tier?.S,
    photoLimit: toInt(ev.photoLimit?.N),
    videoLimit: toInt(ev.videoLimit?.N),
  };
  const photoLimit = entitledPhotoLimit(planRow);
  const extraCredits = toInt(ev.extraPhotoCredits?.N) ?? 0;
  const videoLimit = entitledVideoLimit(planRow);
  const extraVideoCredits = toInt(ev.extraVideoCredits?.N) ?? 0;

  // Reserve a slot atomically. `photoLimit === null` means unlimited (Premium),
  // so the count still increments but never blocks. A missing photoCount is
  // treated as 0, so older events simply start counting from this upload.
  const effectiveLimit = photoLimit === null ? null : photoLimit + extraCredits;
  // Videos are capped separately — see the model comment on `videoLimit`. A
  // missing limit means unlimited, so events created before video limits
  // existed keep working exactly as they did.
  const effectiveVideoLimit =
    !isVideo || videoLimit === null ? null : videoLimit + extraVideoCredits;

  // The video BUDGET, which is what the paid plan is actually sold in now.
  //
  // Checked rather than reserved, and that is a real difference. The count
  // above moves atomically in the same update as photoCount, so it cannot be
  // raced. Bytes cannot: a file's real size is not known until it has landed
  // and sanitize-upload has measured it, so all this can ask is whether the
  // event is ALREADY over budget. A burst of concurrent uploads therefore
  // crosses the line by up to one file each, bounded by the 250 MB per-file
  // ceiling — which is why the fair-use video thresholds sit above the sold
  // figure rather than on it.
  //
  // The alternative is reserving the size the client claims, and the client is
  // not trusted with anything else here; a declared size is a claim like any
  // other, and one that pays to understate.
  if (isVideo) {
    const budget = entitledVideoBytes(planRow);
    if (budget !== null) {
      const usedBytes = toFloat(ev.videoBytes?.N) ?? 0;
      if (usedBytes >= budget) {
        throw new Error(
          `This event has used its ${Math.round(budget / (1024 * 1024 * 1024))} GB of video. Photos are still welcome.`,
        );
      }
    }
  }

  // A limit of zero can't be expressed as a condition: `attribute_not_exists`
  // is true on an event that has never had a video, which would let the first
  // one through. Reject it up front instead.
  if (effectiveVideoLimit === 0) {
    throw new Error('This event’s plan does not include videos.');
  }

  const conditions: string[] = [];
  const update: {
    TableName: string;
    Key: Record<string, AttributeValue>;
    UpdateExpression: string;
    ExpressionAttributeValues: Record<string, AttributeValue>;
    ConditionExpression?: string;
    /** ALL_NEW, so the counters after the reservation come back with it. */
    ReturnValues?: 'ALL_NEW';
  } = {
    TableName: EVENT_TABLE,
    Key: { id: { S: eventId } },
    // Both counters move in ONE update, so a video can never consume a photo
    // slot without also consuming a video slot (or vice versa) when the other
    // condition fails.
    // guestUploadCount rides along in the SAME update rather than in a second
    // write, so it can never drift from photoCount: one succeeds or neither
    // does, and the release below undoes both together.
    UpdateExpression: [
      'ADD photoCount :one',
      isVideo ? 'videoCount :one' : '',
      isGuestUpload ? 'guestUploadCount :one' : '',
    ]
      .filter(Boolean)
      .join(', '),
    ExpressionAttributeValues: { ':one': { N: '1' } },
  };
  if (effectiveLimit !== null) {
    conditions.push('(attribute_not_exists(photoCount) OR photoCount < :limit)');
    update.ExpressionAttributeValues[':limit'] = { N: String(effectiveLimit) };
  }
  if (effectiveVideoLimit !== null) {
    conditions.push('(attribute_not_exists(videoCount) OR videoCount < :videoLimit)');
    update.ExpressionAttributeValues[':videoLimit'] = { N: String(effectiveVideoLimit) };
  }
  if (conditions.length > 0) {
    update.ConditionExpression = conditions.join(' AND ');
  }

  // ---- Fair use ---------------------------------------------------------
  //
  // Checked BEFORE the slot reservation, against the row already read. Two
  // separate things happen here and it matters that they stay separate:
  //
  //   RESTRICTED stops the upload. It is reached by an admin saying so, or by
  //   crossing an abuse threshold set far above any real event.
  //
  //   Everything else does nothing at all to the upload. A big wedding is
  //   flagged for a person to look at and uploads exactly as freely as a small
  //   one. Throttling a paying customer whose event went well is a far more
  //   expensive mistake than letting an abusive event run another hour.
  //
  // See lib/fairUse.ts. Nothing here is a hard-coded number.
  const checkedAt = new Date();
  const fairUse = fairUseConfig(process.env);
  const windowCount = toInt(ev.uploadWindowCount?.N) ?? 0;
  const windowStale = windowExpired(ev.uploadWindowStartedAt?.S ?? null, checkedAt, fairUse);
  const assessment = assessUsage(
    {
      photoCount: toInt(ev.photoCount?.N) ?? 0,
      photoBytes: Number(ev.photoBytes?.N ?? '0'),
      videoBytes: Number(ev.videoBytes?.N ?? '0'),
      derivedBytes: Number(ev.derivedBytes?.N ?? '0'),
      // A stale window is a rate of zero, not the rate from an hour ago.
      windowCount: windowStale ? 0 : windowCount,
      // Feeds the concentration rule. Zero here is the host-only case — a host
      // uploading their photographer's gallery — which is flagged and never
      // blocked on that signal alone. See isConcentrated in fairUse.
      contributorCount: toInt(ev.contributorCount?.N) ?? 0,
      manualStatus: ev.usageStatus?.S ?? null,
    },
    fairUse,
  );
  if (assessment.blocked) {
    // Deliberately vague to the guest, who is not the problem and cannot fix
    // it. The detail is in the logs and the admin dashboard.
    console.warn('Upload refused by fair use', {
      at: checkedAt.toISOString(),
      eventId,
      reasons: assessment.reasons,
    });
    throw new Error('Uploads for this event are paused. Please contact the event host.');
  }

  // Move the rolling window along in the same request that reserved nothing
  // yet. Best-effort and deliberately not conditional: this counter exists to
  // be looked at, and a lost increment under contention understates a burst
  // rather than refusing a photo.
  const advanceWindow = () =>
    dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          ...(windowStale
            ? {
                UpdateExpression:
                  'SET uploadWindowCount = :one, uploadWindowStartedAt = :now',
                ExpressionAttributeValues: {
                  ':one': { N: '1' },
                  ':now': { S: checkedAt.toISOString() },
                },
              }
            : {
                UpdateExpression: 'ADD uploadWindowCount :one',
                ExpressionAttributeValues: { ':one': { N: '1' } },
              }),
        }),
      )
      .catch(() => undefined);

  // ALL_NEW so the counters after the reservation are known without a second
  // read. Milestones are derived from the before/after pair, which is what
  // stops a re-read racing another upload and firing the same one twice.
  update.ReturnValues = 'ALL_NEW';
  let reserved: Record<string, AttributeValue> | undefined;
  try {
    reserved = (await dynamo.send(new UpdateItemCommand(update))).Attributes;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      // Either ceiling can be the one that failed. Naming the wrong one sends
      // the host to buy the wrong thing, so check which is actually full.
      const photoCount = toInt(ev.photoCount?.N) ?? 0;
      const photosFull = effectiveLimit !== null && photoCount >= effectiveLimit;
      throw new Error(
        photosFull || !isVideo
          ? 'This event has reached its photo limit.'
          : 'This event has reached its video limit.',
      );
    }
    throw error;
  }

  void advanceWindow();

  // Funnel milestones. Best-effort and never awaited into the upload's own
  // outcome: a photo that is safely stored must not fail because a counter
  // could not be written. Each is once-per-event at the table, so a second
  // upload crossing the same line records nothing.
  void recordUploadMilestones({
    eventId,
    isGuestUpload,
    before: {
      guestUploads: toInt(ev.guestUploadCount?.N) ?? 0,
      contributors: toInt(ev.contributorCount?.N) ?? 0,
    },
    after: {
      guestUploads: toInt(reserved?.guestUploadCount?.N) ?? 0,
      contributors: toInt(reserved?.contributorCount?.N) ?? 0,
    },
  });

  const releaseSlot = () =>
    dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: [
            'ADD photoCount :neg',
            isVideo ? 'videoCount :neg' : '',
            isGuestUpload ? 'guestUploadCount :neg' : '',
          ]
            .filter(Boolean)
            .join(', '),
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

  // The moment the guest was filing under, usually preselected by the QR code
  // they scanned. A claim, not a fact: keep it only if that moment exists AND
  // belongs to this event, otherwise the photo is simply unfiled.
  //
  // Deliberately never fatal. The commonest reason this fails is a card printed
  // for a moment the host has since deleted, and refusing an upload the guest
  // already waited through — at an event, on venue wifi — over a filing label
  // would be the wrong trade every time.
  let momentId: string | null = null;
  const claimedMoment = (event.arguments.momentId ?? '').toString().trim();
  if (claimedMoment) {
    const moment = await dynamo
      .send(
        new GetItemCommand({
          TableName: MOMENT_TABLE,
          Key: { id: { S: claimedMoment } },
          ProjectionExpression: 'id, eventId',
        }),
      )
      .catch(() => null);
    if (moment?.Item?.eventId?.S === eventId) {
      momentId = claimedMoment;
    } else {
      console.warn('Upload referenced a moment outside its event', {
        eventId,
        momentId: claimedMoment,
      });
    }
  }

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
  if (momentId) item.momentId = { S: momentId };

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

  // Count the person, now that their photo is definitely stored. Host uploads
  // are excluded: "the host uploaded forty photos" is exactly the case this
  // metric exists to tell apart from an event that guests turned up to.
  if (isGuestUpload) {
    await recordContributor(eventId, uploadedBy, now);
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
