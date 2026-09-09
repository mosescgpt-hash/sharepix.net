import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import type { Schema } from '../../data/resource';
import { analyticsId, firesOnce, isAnalyticsEvent } from './analytics';

const dynamo = new DynamoDBClient({});
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME as string;

type Handler = Schema['recordAnalyticsEvent']['functionHandler'];

/** Detail is context, not an essay, and never anything identifying a person. */
const MAX_DETAIL_LENGTH = 500;
/** Bounds the scope so it cannot be used to write an unbounded key. */
const MAX_SCOPE_LENGTH = 128;

/**
 * Record an event, or quietly decline to.
 *
 * Always answers `true`. A funnel is telemetry: a browser that cannot record a
 * page view must not be told something went wrong, and a caller that could tell
 * the difference between "stored" and "already stored" could probe which
 * milestones an event has reached. The reasons live in the log.
 */
export const handler: Handler = async (event) => {
  const name = (event.arguments?.name ?? '').toString();
  if (!ANALYTICS_TABLE || !isAnalyticsEvent(name)) {
    // An unknown name is a client sending something this build does not know.
    console.warn('Declined an unknown analytics event', { name: name.slice(0, 64) });
    return true;
  }

  const scopeId = (event.arguments?.scopeId ?? 'anon').toString().slice(0, MAX_SCOPE_LENGTH) || 'anon';
  const detail = (event.arguments?.detailJson ?? '').toString().slice(0, MAX_DETAIL_LENGTH);
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
          ...(detail ? { detailJson: { S: detail } } : {}),
          // Stamped here, never from the request. A browser's clock is a claim
          // and a funnel ordered by it would be orderable by anyone.
          occurredAt: { S: now },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        // Only milestones need this; a repeatable event's id is unique anyway,
        // so the condition costs nothing and closes the id-collision case too.
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      // Already recorded. The ordinary answer for a milestone, and for a
      // reloaded page that re-fires one.
      if (!firesOnce(name)) {
        console.warn('Analytics id collided on a repeatable event', { name, scopeId });
      }
      return true;
    }
    console.error('Could not record an analytics event', {
      at: now,
      name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
};
