import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { timingSafeEqual } from 'node:crypto';
import type { Schema } from '../../data/resource';
import {
  DEFAULT_DISPLAY_MODE,
  FEEDBACK_MAX_LENGTH,
  TESTIMONIAL_MAX_LENGTH,
  branchFor,
  cleanText,
  consentFrom,
  isDisplayMode,
  normalizeRating,
} from './customerRating';
import { decodeRatingLink } from './ratingLink';

const dynamo = new DynamoDBClient({});
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE_NAME as string;

type Handler = Schema['submitEventFeedback']['functionHandler'];

/**
 * The same answer for a malformed link, a wrong token and an unknown event.
 *
 * Anything else lets a stranger discover which event ids are real by feeding
 * the endpoint guesses.
 */
const REFUSED = 'That link is not valid. It may have expired.';

function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const handler: Handler = async (event) => {
  const parts = decodeRatingLink(event.arguments.link ?? '');
  if (!parts || !FEEDBACK_TABLE) throw new Error(REFUSED);

  const found = await dynamo
    .send(new GetItemCommand({ TableName: FEEDBACK_TABLE, Key: { id: { S: parts.eventId } } }))
    .catch(() => null);

  const row = found?.Item;
  if (!row || !tokensMatch(row.ratingToken?.S ?? '', parts.token)) {
    throw new Error(REFUSED);
  }

  const now = new Date().toISOString();
  const eventName = row.eventName?.S ?? '';
  // What is already on the row, which is what decides what may still be
  // written. Every fact comes from storage; nothing about the caller's own
  // claims is trusted beyond the free text they are entitled to write.
  const existingRating = Number.isFinite(Number(row.rating?.N)) ? Number(row.rating?.N) : null;

  const sets: string[] = ['updatedAt = :now'];
  const values: Record<string, AttributeValue> = { ':now': { S: now } };
  const names: Record<string, string> = {};

  // ---- The score -------------------------------------------------------
  //
  // Settable once. A link that could re-rate is a link a forwarder, or anyone
  // who ever saw the email, could use to overwrite somebody's opinion — and
  // the second write would look exactly like the first.
  const incoming = normalizeRating(event.arguments.rating ?? null);
  if (incoming !== null && existingRating === null) {
    sets.push('rating = :rating', 'ratingSubmittedAt = :now');
    values[':rating'] = { N: String(incoming) };
    // A low score is somebody telling us the product did not work. It opens a
    // follow-up that a person has to close, and it is never quietly filed.
    if (branchFor(incoming) === 'support') {
      sets.push('supportFollowUpNeeded = :true');
      values[':true'] = { BOOL: true };
    }
  }

  const effectiveRating = existingRating ?? incoming;

  // ---- What they wrote -------------------------------------------------
  const feedback = cleanText(event.arguments.privateFeedback, FEEDBACK_MAX_LENGTH);
  if (feedback) {
    sets.push('privateFeedback = :feedback');
    values[':feedback'] = { S: feedback };
  }

  const testimonial = cleanText(event.arguments.testimonialText, TESTIMONIAL_MAX_LENGTH);
  if (testimonial) {
    sets.push(
      'testimonialText = :testimonial',
      'testimonialSubmittedAt = :now',
      '#status = if_not_exists(#status, :new)',
    );
    names['#status'] = 'status';
    values[':testimonial'] = { S: testimonial };
    values[':new'] = { S: 'NEW' };
  }

  // ---- Permission ------------------------------------------------------
  //
  // Only an explicit true grants anything, and the wording they agreed to is
  // stored beside it so an old grant keeps meaning what it said. A grant with
  // no testimonial attached is recorded as given but publishes nothing:
  // mayPublish() requires both, and it is the only place that decision is made.
  const consent = consentFrom(event.arguments.marketingPermission);
  if (consent.granted) {
    sets.push(
      'marketingPermission = :granted',
      'permissionGrantedAt = :now',
      'consentVersion = :consentVersion',
    );
    values[':granted'] = { BOOL: true };
    values[':consentVersion'] = { S: consent.consentVersion };

    // How they want to be credited. Anonymous unless they chose otherwise —
    // a name published because a default said so is not a name anyone agreed
    // to publish.
    const mode = isDisplayMode(event.arguments.displayMode)
      ? event.arguments.displayMode
      : DEFAULT_DISPLAY_MODE;
    sets.push('displayMode = :mode');
    values[':mode'] = { S: mode };
    const name = cleanText(event.arguments.displayName, 80);
    if (name && mode !== 'anonymous') {
      sets.push('displayName = :displayName');
      values[':displayName'] = { S: name };
    }
  } else if (event.arguments.marketingPermission === false) {
    // An explicit withdrawal. Recorded rather than ignored, because someone
    // who ticked the box and then thought better of it must be able to undo it
    // from the same page, and because publishing checks this flag at the
    // moment of publishing rather than what was true when an admin clicked.
    sets.push('marketingPermission = :denied');
    values[':denied'] = { BOOL: false };
  }

  if (sets.length > 1) {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: FEEDBACK_TABLE,
        Key: { id: { S: parts.eventId } },
        UpdateExpression: `SET ${sets.join(', ')}`,
        // Only ever fills in a row the daily job already created with a token.
        // Without this a guessed id would create a row, and a row with no
        // token is a row nobody can prove they were sent.
        ConditionExpression: 'attribute_exists(id)',
        ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
        ExpressionAttributeValues: values,
      }),
    );
  }

  // What the page shows next. 'done' once they have written something, so a
  // reload does not ask again for what has already been given.
  const branch = testimonial || feedback ? 'done' : (branchFor(effectiveRating) ?? 'done');

  return {
    recorded: true,
    branch,
    eventName,
    message:
      branch === 'support'
        ? 'Thank you. Tell us what went wrong and we will look at it.'
        : branch === 'testimonial'
          ? 'Thank you. Would you be willing to say a little more?'
          : 'Thank you — that is recorded.',
  };
};
