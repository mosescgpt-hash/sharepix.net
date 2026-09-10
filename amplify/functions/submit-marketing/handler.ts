import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { RELEASE_VERSION, tierByKey, type SubmittedAsset } from './marketingRelease';
import { analyticsId } from './analytics';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({});
const MARKETING_TABLE = process.env.MARKETING_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME ?? '';

type Handler = Schema['submitMarketingOffer']['functionHandler'];

/** Their words about the event. Long enough to be useful, bounded anyway. */
const MAX_TESTIMONIAL = 2000;

/**
 * Record an offer of photos for marketing.
 *
 * Everything that decides what the offer *means* is set here rather than taken
 * from the request: the release version, the moment it was accepted, and the
 * decision on each asset. A submission arrives as a list of photo ids and a
 * confirmation; it leaves as a row saying which specific photos a named person
 * offered, under which wording, at which second — and granting nothing until
 * somebody reviews it.
 */
export const handler: Handler = async (event) => {
  const identity = event.identity as { sub?: string } | null | undefined;
  const sub = identity?.sub ?? '';
  if (!sub) throw new Error('Sign in to offer photos.');

  const eventId = (event.arguments?.eventId ?? '').toString();
  const tierKey = (event.arguments?.tierKey ?? '').toString();
  const tier = tierByKey(tierKey);
  if (!eventId || !tier) throw new Error('That is not one of the Featured Event options.');

  // The rights confirmation is the point of the whole exercise. Without it
  // there is no offer, only a list of photos.
  if (event.arguments?.rightsConfirmed !== true) {
    throw new Error('Please confirm the photos are yours to share.');
  }

  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  const row = found?.Item;
  // One answer for "no such event" and "not yours", so this cannot be used to
  // discover which event ids exist.
  if (!row || !(row.owner?.S ?? '').includes(sub)) {
    throw new Error('That event could not be found.');
  }

  const requested = (event.arguments?.photoIds ?? [])
    .map((id) => (id ?? '').toString().trim())
    .filter(Boolean);
  const photoIds = [...new Set(requested)].slice(0, tier.maxAssets);
  if (photoIds.length < tier.minAssets) {
    throw new Error(`Please choose at least ${tier.minAssets} photos for this option.`);
  }

  // Every asset starts PENDING, whatever the request said. A submission is an
  // offer; only a person reviewing it can accept one, and an asset that arrived
  // marked accepted would be a licence nobody granted.
  const assets: SubmittedAsset[] = photoIds.map((photoId) => ({ photoId, decision: 'PENDING' }));

  const now = new Date().toISOString();
  const testimonial = (event.arguments?.testimonial ?? '').toString().trim().slice(0, MAX_TESTIMONIAL);

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: MARKETING_TABLE,
        Item: {
          // One offer per event. A second submission is a conditional-put
          // failure rather than a second row, so a reloaded page cannot create
          // two consent records that disagree about what was granted.
          id: { S: eventId },
          __typename: { S: 'MarketingSubmission' },
          eventId: { S: eventId },
          customer: { S: row.owner?.S ?? '' },
          eventName: { S: row.name?.S ?? '' },
          tierKey: { S: tier.key },
          status: { S: 'SUBMITTED' },
          assetsJson: { S: JSON.stringify(assets) },
          ...(testimonial ? { testimonial: { S: testimonial } } : {}),
          // Stamped here, never sent. Which wording somebody agreed to, and
          // when, is the entire legal content of this row.
          releaseVersion: { S: RELEASE_VERSION },
          releaseAcceptedAt: { S: now },
          rightsConfirmed: { BOOL: true },
          submittedAt: { S: now },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return {
        recorded: false,
        message: 'You have already offered photos from this event. We will be in touch.',
      };
    }
    console.error('Could not record a marketing offer', {
      at: now,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('That could not be saved. Please try again.');
  }

  // The Continue stage. Once per event, like the row it describes.
  if (ANALYTICS_TABLE) {
    await dynamo
      .send(
        new PutItemCommand({
          TableName: ANALYTICS_TABLE,
          Item: {
            id: { S: analyticsId('featured_event_submitted', eventId, randomUUID()) },
            __typename: { S: 'AnalyticsEvent' },
            name: { S: 'featured_event_submitted' },
            scopeId: { S: eventId },
            occurredAt: { S: now },
            createdAt: { S: now },
            updatedAt: { S: now },
          },
        }),
      )
      .catch(() => undefined);
  }

  return {
    recorded: true,
    message:
      'Thank you. We will look at these and let you know which we can use — and nothing is published unless we do.',
  };
};
