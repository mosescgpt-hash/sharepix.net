// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});

const REVIEW_TABLE = process.env.REVIEW_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;

type Handler = Schema['reviewFlaggedPhoto']['functionHandler'];

/**
 * Decide a flagged photo from a review link.
 *
 * This runs unauthenticated, so the token is the only credential and every
 * check happens here — never on the client:
 *   - the review must exist, still be pending, and not have expired;
 *   - the photo it points at must still be flagged;
 *   - the review is closed atomically, so a link can't be replayed.
 *
 * Neither outcome deletes anything. 'release' makes the photo visible;
 * 'dismiss' leaves it hidden. Permanent deletion stays behind the host's
 * signed-in dashboard, so a leaked link cannot destroy a couple's photos.
 */
export const handler: Handler = async (event) => {
  const token = (event.arguments.token ?? '').trim();
  const action = (event.arguments.action ?? '').trim().toLowerCase();

  if (!token) return { success: false, message: 'This review link is not valid.' };
  if (action !== 'release' && action !== 'dismiss') {
    return { success: false, message: 'That action is not recognized.' };
  }

  const found = await dynamo.send(
    new GetItemCommand({ TableName: REVIEW_TABLE, Key: { token: { S: token } } }),
  );
  const review = found.Item;
  // Same message whether the token is unknown or malformed, so the response
  // can't be used to probe for valid tokens.
  if (!review) return { success: false, message: 'This review link is not valid.' };

  const status = review.status?.S ?? '';
  if (status !== 'pending') {
    return { success: false, message: 'This photo has already been reviewed.' };
  }

  const expiresAt = review.expiresAt?.S ?? '';
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return {
      success: false,
      message: 'This review link has expired. Open the event dashboard to review the photo.',
    };
  }

  const photoId = review.photoId?.S ?? '';
  if (!photoId) return { success: false, message: 'This review link is not valid.' };

  const now = new Date().toISOString();
  const nextStatus = action === 'release' ? 'released' : 'dismissed';

  // Close the review first, conditional on it still being pending. That makes
  // the link single-use: two clicks race, and only one wins.
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: REVIEW_TABLE,
        Key: { token: { S: token } },
        UpdateExpression: 'SET #status = :next, decidedAt = :now, updatedAt = :now',
        ConditionExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':next': { S: nextStatus },
          ':pending': { S: 'pending' },
          ':now': { S: now },
        },
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return { success: false, message: 'This photo has already been reviewed.' };
    }
    throw error;
  }

  if (action === 'release') {
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: PHOTO_TABLE,
          Key: { id: { S: photoId } },
          UpdateExpression: 'SET moderationStatus = :released, updatedAt = :now',
          // Only a still-flagged photo can be released, so this can't resurrect
          // one the host hid by hand afterwards.
          ConditionExpression: 'attribute_exists(id) AND moderationStatus = :flagged',
          ExpressionAttributeValues: {
            ':released': { S: 'released' },
            ':flagged': { S: 'flagged' },
            ':now': { S: now },
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        return {
          success: false,
          message: 'That photo is no longer awaiting review.',
        };
      }
      throw error;
    }
    return { success: true, message: 'Photo released — guests and the slideshow can see it now.' };
  }

  return { success: true, message: 'Photo kept hidden. Guests will not see it.' };
};
