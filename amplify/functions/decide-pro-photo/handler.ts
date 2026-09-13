import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { connectionId, mayReviewEvent } from './photographerAccess';
import {
  DEFAULT_PUBLISHING_MODE,
  canTransition,
  isPublishStatus,
  isPublishingMode,
  shouldPublishOnApproval,
  type PublishStatus,
} from './professionalMedia';

const dynamo = new DynamoDBClient({});
const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;

/** What a caller may ask for, and where each one lands. */
const DECISIONS: Record<string, PublishStatus> = {
  approve: 'approved',
  reject: 'rejected',
  publish: 'published',
  unpublish: 'approved',
};

type DecideHandler = Schema['decideProPhoto']['functionHandler'];

/** The same "not found" for every way of not being allowed. */
const DENIED = 'That photo could not be found.';

/**
 * Move one professional photo through its lifecycle.
 *
 * ## Three checks, in this order
 *
 * 1. **Is this the photographer's own photo?** Not the host's, not another
 *    photographer on the same event. A photographer decides what happens to
 *    their own work and nobody else's, so the row's photographerId must equal
 *    the caller's sub.
 * 2. **Are they still on the event?** A removed photographer stops being able
 *    to publish immediately, not when a session expires.
 * 3. **Is the move legal?** canTransition, server-side. The dashboard decides
 *    which buttons to draw; it decides nothing about what happens.
 *
 * ## Approving is not always publishing
 *
 * An approval publishes only when the photographer is live and their mode says
 * so — shouldPublishOnApproval. Paused means a photographer can work through
 * their queue mid-ceremony with nothing appearing on the screen behind the
 * altar, and everything they approved goes up when they resume.
 */
export const handler: DecideHandler = async (event) => {
  const sub = event.identity && 'sub' in event.identity ? String(event.identity.sub) : '';
  if (!sub) throw new Error(DENIED);

  // setProPublishing shares this handler; it carries an eventId, not an uploadId.
  const eventId = 'eventId' in event.arguments ? String(event.arguments.eventId ?? '') : '';
  if (eventId) return setPublishing(event, sub, eventId);

  const uploadId = String(event.arguments.uploadId ?? '');
  const decision = String(event.arguments.decision ?? '');
  const target = DECISIONS[decision];
  if (!uploadId || !target) throw new Error(DENIED);

  const photoRow = await dynamo
    .send(new GetItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: uploadId } } }))
    .catch(() => null);
  const photo = photoRow?.Item;
  // Their own photo, and a professional one. A guest photo has no publish
  // status and must never be reachable through this path.
  if (!photo || photo.photographerId?.S !== sub || photo.sourceType?.S !== 'professional') {
    throw new Error(DENIED);
  }

  const photoEventId = photo.eventId?.S ?? '';
  const connection = await loadConnection(photoEventId, sub);
  if (!mayReviewEvent(connection, photoEventId, sub)) throw new Error(DENIED);

  const from = photo.publishStatus?.S ?? '';
  if (!isPublishStatus(from) || !canTransition(from, target)) {
    throw new Error(`That photo cannot go from ${from || 'unknown'} to ${target}.`);
  }

  // An approval only reaches the gallery if this photographer is live.
  const live = connection?.livePublishing === true;
  const mode = isPublishingMode(connection?.publishingMode)
    ? connection.publishingMode
    : DEFAULT_PUBLISHING_MODE;
  const landing: PublishStatus =
    target === 'approved' && decision === 'approve' && shouldPublishOnApproval({ livePublishing: live, mode })
      ? 'published'
      : target;

  const now = new Date().toISOString();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: PHOTO_TABLE,
      Key: { id: { S: uploadId } },
      UpdateExpression:
        'SET publishStatus = :next, updatedAt = :now, approved = :approved' +
        (landing === 'published' ? ', publishedAt = :now' : ''),
      // Only from the status we checked. Two tabs open on one queue must not
      // both win, and a stale button must not undo a decision already made.
      ConditionExpression: 'publishStatus = :from',
      ExpressionAttributeValues: {
        ':next': { S: landing },
        ':from': { S: from },
        ':now': { S: now },
        // `approved` is the field the existing gallery reads. A professional
        // photo is visible to guests only when published, so the two agree.
        ':approved': { BOOL: landing === 'published' },
      },
    }),
  );

  return {
    uploadId,
    publishStatus: landing,
    message: landing === 'published' ? 'Live in the gallery.' : `Marked ${landing}.`,
  };
};

async function loadConnection(eventId: string, sub: string) {
  if (!eventId) return null;
  const row = await dynamo
    .send(
      new GetItemCommand({
        TableName: CONNECTION_TABLE,
        Key: { id: { S: connectionId(eventId, sub) } },
      }),
    )
    .catch(() => null);
  if (!row?.Item) return null;
  return {
    eventId: row.Item.eventId?.S ?? null,
    photographerId: row.Item.photographerId?.S ?? null,
    status: row.Item.status?.S ?? null,
    livePublishing: row.Item.livePublishing?.BOOL ?? false,
    publishingMode: row.Item.publishingMode?.S ?? null,
  };
}

/**
 * Go Live, Pause, and the publishing mode.
 *
 * Writes the connection row, which the photographer has no direct write access
 * to — that is the point of routing it through here. Turning Go Live on does
 * NOT sweep up everything already approved: that would put a backlog on a
 * venue screen all at once, which is exactly the surprise Pause exists to
 * prevent. Approved work publishes as the photographer works through it.
 */
async function setPublishing(
  event: Parameters<DecideHandler>[0],
  sub: string,
  eventId: string,
) {
  const connection = await loadConnection(eventId, sub);
  if (!mayReviewEvent(connection, eventId, sub)) throw new Error(DENIED);

  const args = event.arguments as { livePublishing?: boolean | null; publishingMode?: string | null };
  const sets: string[] = ['updatedAt = :now'];
  const values: Record<string, { S: string } | { BOOL: boolean }> = {
    ':now': { S: new Date().toISOString() },
  };

  if (typeof args.livePublishing === 'boolean') {
    sets.push('livePublishing = :live');
    values[':live'] = { BOOL: args.livePublishing };
  }
  if (isPublishingMode(args.publishingMode)) {
    sets.push('publishingMode = :mode');
    values[':mode'] = { S: args.publishingMode };
  }
  if (sets.length === 1) throw new Error('Nothing to change.');

  await dynamo.send(
    new UpdateItemCommand({
      TableName: CONNECTION_TABLE,
      Key: { id: { S: connectionId(eventId, sub) } },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeValues: values,
    }),
  );

  return {
    uploadId: '',
    publishStatus: args.livePublishing === false ? 'paused' : 'live',
    message:
      args.livePublishing === false
        ? 'Paused. Nothing new reaches the gallery until you go live again.'
        : 'Live. Photos publish as you approve them.',
  };
}
