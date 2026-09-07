// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { timingSafeEqual } from 'node:crypto';
import type { Schema } from '../../data/resource';
import { canTransition, completionMessage, incentiveId } from './researchIncentive';
import { decodeSurveyLink } from './surveyLink';

const dynamo = new DynamoDBClient({});
const INCENTIVE_TABLE = process.env.INCENTIVE_TABLE_NAME as string;
/** Optional, and omitted when unset rather than promising a number. */
const FULFILMENT_DAYS = process.env.RESEARCH_FULFILMENT_DAYS ?? '';

type Handler = Schema['completeResearchSurvey']['functionHandler'];

/**
 * The same answer for a malformed link, a wrong token and an unknown event.
 *
 * Anything else lets a stranger discover which event ids are real by feeding
 * the endpoint guesses.
 */
const REFUSED = 'That survey link is not valid. It may have expired.';

function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const handler: Handler = async (event) => {
  const parts = decodeSurveyLink(event.arguments.link ?? '');
  if (!parts || !INCENTIVE_TABLE) throw new Error(REFUSED);

  const id = incentiveId(parts.eventId, parts.surveyId);
  const found = await dynamo
    .send(new GetItemCommand({ TableName: INCENTIVE_TABLE, Key: { id: { S: id } } }))
    .catch(() => null);

  const row = found?.Item;
  if (!row || !tokensMatch(row.surveyToken?.S ?? '', parts.token)) {
    throw new Error(REFUSED);
  }

  const status = row.status?.S ?? 'PENDING';
  const now = new Date().toISOString();

  // Already recorded. Not an error: someone reloading the page, or clicking
  // the link again from the same email, must see the same calm confirmation
  // rather than a failure for something that already worked.
  if (status === 'AWAITING_MANUAL_FULFILLMENT' || status === 'FULFILLED') {
    return {
      recorded: true,
      message: completionMessage(
        Number(row.amountUsd?.N ?? '25'),
        FULFILMENT_DAYS || undefined,
      ),
    };
  }

  // Every other state is one a person put it in — cancelled, disqualified, or
  // a failed send being retried. A visitor must not be able to move it back.
  if (!canTransition(status as never, 'AWAITING_MANUAL_FULFILLMENT')) {
    throw new Error(REFUSED);
  }

  // The one transition this endpoint may make. Conditional on the status it
  // read, so two submissions racing cannot both apply it, and so a status a
  // person changed in between wins over what this saw.
  //
  // Note what is NOT set: nothing here writes fulfilledAt or FULFILLED. This
  // creates an obligation; a human discharges it.
  await dynamo.send(
    new UpdateItemCommand({
      TableName: INCENTIVE_TABLE,
      Key: { id: { S: id } },
      UpdateExpression:
        'SET #status = :next, completedAt = :now, updatedAt = :now',
      ConditionExpression: '#status = :seen',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':next': { S: 'AWAITING_MANUAL_FULFILLMENT' },
        ':seen': { S: status },
        ':now': { S: now },
      },
    }),
  );

  return {
    recorded: true,
    message: completionMessage(
      Number(row.amountUsd?.N ?? '25'),
      FULFILMENT_DAYS || undefined,
    ),
  };
};
