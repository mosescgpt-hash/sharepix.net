// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import Stripe from 'stripe';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({});
const lambda = new LambdaClient({});
const PAYMENT_TABLE = process.env.PAYMENT_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CORPORATE_TABLE = process.env.CORPORATE_TABLE_NAME as string;
const DISCOUNT_TABLE = process.env.DISCOUNT_TABLE_NAME as string;
// Background function that talks to Prodigi. The webhook only hands off to it
// (async) so a slow Prodigi never blocks the Stripe response.
const PRINT_FULFILL_FUNCTION = process.env.PRINT_FULFILL_FUNCTION_NAME as string;

const DAY_MS = 24 * 60 * 60 * 1000;

// Upsert a corporate subscription row from a Stripe subscription object. Owner is
// stamped from the checkout metadata so the host can read their own row.
async function upsertCorporateSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) return; // not one of ours
  const owner = subscription.metadata?.owner ?? '';
  const now = new Date().toISOString();
  const periodEndMs = (subscription.current_period_end ?? 0) * 1000;
  const currentPeriodEnd = periodEndMs ? new Date(periodEndMs).toISOString() : '';
  // Downloads stay available until 30 days past the current period end.
  const graceEndsAt = periodEndMs ? new Date(periodEndMs + 30 * DAY_MS).toISOString() : '';

  const item: Record<string, { S: string } | { BOOL: boolean }> = {
    userId: { S: userId },
    __typename: { S: 'CorporateSubscription' },
    status: { S: subscription.status ?? 'active' },
    stripeSubscriptionId: { S: subscription.id },
    cancelAtPeriodEnd: { BOOL: Boolean(subscription.cancel_at_period_end) },
    updatedAt: { S: now },
    createdAt: { S: now },
  };
  if (owner) item.owner = { S: owner };
  if (typeof subscription.customer === 'string') {
    item.stripeCustomerId = { S: subscription.customer };
  }
  if (currentPeriodEnd) item.currentPeriodEnd = { S: currentPeriodEnd };
  if (graceEndsAt) item.downloadGraceEndsAt = { S: graceEndsAt };

  await dynamo.send(new PutItemCommand({ TableName: CORPORATE_TABLE, Item: item }));
}

const DAY_MS_WINDOW = 24 * 60 * 60 * 1000;

/** Push an event's upload window out by 30 days, stacking on any existing end. */
async function extendUploadWindow(eventId: string, now: string) {
  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  if (!found.Item) return;
  const current = found.Item.uploadWindowEndsAt?.S;
  const base = current ? new Date(current).getTime() : Date.now();
  // Extend from the later of now / current end, so extensions stack.
  const from = Math.max(base, Date.now());
  const next = new Date(from + 30 * DAY_MS_WINDOW).toISOString();
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      UpdateExpression: 'SET uploadWindowEndsAt = :next, updatedAt = :now',
      ExpressionAttributeValues: { ':next': { S: next }, ':now': { S: now } },
    }),
  );
}

/** Turn on one boolean flag on an event (an add-on becoming active). */
async function setEventFlag(eventId: string, field: string, now: string) {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      UpdateExpression: 'SET #field = :true, #updatedAt = :now',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeNames: { '#field': field, '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':true': { BOOL: true }, ':now': { S: now } },
    }),
  );
}

// constructEvent only needs the signing secret to verify the payload — the API
// key isn't used, but the Stripe client requires one to instantiate.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_placeholder');

/**
 * Stripe calls this Function URL when a payment event happens. We verify the
 * signature (so only real Stripe events are trusted), then record completed
 * checkouts as Payment rows the admin dashboard can count.
 */
export const handler = async (event: {
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
}) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { statusCode: 500, body: 'Webhook is not configured.' };
  }

  // Signature header casing varies; Function URLs lowercase header names.
  const headers = event.headers ?? {};
  const signature =
    headers['stripe-signature'] ?? headers['Stripe-Signature'] ?? '';

  // constructEvent must see the exact raw bytes Stripe sent, so decode base64
  // (Function URLs base64-encode bodies) and never JSON.parse first.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : event.body ?? '';

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    // Bad signature or malformed body — reject so Stripe surfaces the failure.
    return {
      statusCode: 400,
      body: `Signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object as Stripe.Checkout.Session;
    const now = new Date().toISOString();
    const eventId = session.metadata?.eventId ?? '';
    try {
      await dynamo.send(
        new PutItemCommand({
          TableName: PAYMENT_TABLE,
          Item: {
            id: { S: randomUUID() },
            __typename: { S: 'Payment' },
            stripeSessionId: { S: session.id },
            amountTotal: { N: String(session.amount_total ?? 0) },
            currency: { S: session.currency ?? 'usd' },
            tier: { S: session.metadata?.tier ?? 'unknown' },
            eventId: { S: eventId },
            customerEmail: {
              S: session.customer_details?.email ?? session.customer_email ?? '',
            },
            status: { S: session.payment_status ?? 'paid' },
            createdAt: { S: now },
            updatedAt: { S: now },
          },
        }),
      );
    } catch (err) {
      // Log and return 500 so Stripe retries — better than silently dropping.
      console.error('Failed to record payment', err);
      return { statusCode: 500, body: 'Failed to record payment.' };
    }

    // Count a discount-code redemption once the payment actually completes, so a
    // started-but-abandoned checkout never burns a use. Best-effort: usage
    // accounting must not fail the webhook (which would make Stripe retry and
    // double-apply the real side effects above).
    const discountCode = session.metadata?.discountCode ?? '';
    if (discountCode) {
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: DISCOUNT_TABLE,
            Key: { code: { S: discountCode } },
            UpdateExpression: 'ADD usedCount :one SET lastUsedAt = :now',
            ConditionExpression: 'attribute_exists(code)',
            ExpressionAttributeValues: { ':one': { N: '1' }, ':now': { S: now } },
          }),
        );
      } catch (err) {
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') {
          console.error('Failed to record discount-code use', err);
        }
      }
    }

    // Apply the event side effect of this payment, if any:
    //  - extend_window → push the upload window out by 30 days
    //  - guest_download add-on → enable guest downloads on the event
    //  - prints → no event change (fulfilment is handed off below)
    //  - otherwise (event payment) → activate the pending event
    if (eventId && session.metadata?.kind !== 'prints') {
      const kind = session.metadata?.kind ?? '';
      try {
        if (kind === 'addons') {
          // One checkout, several add-ons. The keys were re-derived server-side
          // when the session was created, so this just applies each one.
          const keys = (session.metadata?.addons ?? '')
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
          for (const key of keys) {
            if (key === 'extend') {
              await extendUploadWindow(eventId, now);
            } else if (key === 'guest_download') {
              await setEventFlag(eventId, 'guestDownloadEnabled', now);
            } else if (key === 'live_slideshow') {
              await setEventFlag(eventId, 'liveSlideshowEnabled', now);
            }
          }
        } else if (kind === 'extend_window') {
          const DAY_MS = 24 * 60 * 60 * 1000;
          const found = await dynamo.send(
            new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
          );
          if (found.Item) {
            const current = found.Item.uploadWindowEndsAt?.S;
            const base = current ? new Date(current).getTime() : Date.now();
            // Extend from the later of now / current end, so extensions stack.
            const from = Math.max(base, Date.now());
            const next = new Date(from + 30 * DAY_MS).toISOString();
            await dynamo.send(
              new UpdateItemCommand({
                TableName: EVENT_TABLE,
                Key: { id: { S: eventId } },
                UpdateExpression: 'SET uploadWindowEndsAt = :next, updatedAt = :now',
                ExpressionAttributeValues: { ':next': { S: next }, ':now': { S: now } },
              }),
            );
          }
        } else {
          // Each add-on flips its own flag; a plain event payment marks it paid.
          const field =
            kind === 'guest_download'
              ? 'guestDownloadEnabled'
              : kind === 'live_slideshow'
                ? 'liveSlideshowEnabled'
                : 'paid';
          await dynamo.send(
            new UpdateItemCommand({
              TableName: EVENT_TABLE,
              Key: { id: { S: eventId } },
              UpdateExpression: 'SET #field = :true, #updatedAt = :now',
              ConditionExpression: 'attribute_exists(id)',
              ExpressionAttributeNames: { '#field': field, '#updatedAt': 'updatedAt' },
              ExpressionAttributeValues: { ':true': { BOOL: true }, ':now': { S: now } },
            }),
          );
        }
      } catch (err) {
        // A missing event (e.g. deleted before payment) shouldn't fail the
        // webhook — the payment is still recorded. Retry-worthy errors surface.
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') {
          console.error('Failed to apply event payment', err);
          return { statusCode: 500, body: 'Failed to apply event payment.' };
        }
      }
    }

    // Corporate subscription: activate the account as soon as the subscription
    // checkout completes, even if the customer.subscription.* events aren't yet
    // configured on the webhook. The subscription.* events (once enabled) then
    // fill in period end / cancellation. Merge with UpdateItem so we never wipe
    // fields a subscription.* event may have already written.
    if (session.metadata?.kind === 'corporate' && session.metadata?.userId) {
      try {
        await dynamo.send(
          new UpdateItemCommand({
            TableName: CORPORATE_TABLE,
            Key: { userId: { S: session.metadata.userId } },
            UpdateExpression:
              'SET #status = :active, #owner = :owner, stripeCustomerId = :cust, stripeSubscriptionId = :subId, updatedAt = :now, createdAt = if_not_exists(createdAt, :now), #typename = :typename',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#owner': 'owner',
              '#typename': '__typename',
            },
            ExpressionAttributeValues: {
              ':active': { S: 'active' },
              ':owner': { S: session.metadata.owner ?? '' },
              ':cust': { S: typeof session.customer === 'string' ? session.customer : '' },
              ':subId': {
                S: typeof session.subscription === 'string' ? session.subscription : '',
              },
              ':now': { S: now },
              ':typename': { S: 'CorporateSubscription' },
            },
          }),
        );
      } catch (err) {
        console.error('Failed to activate corporate subscription', err);
        return { statusCode: 500, body: 'Failed to activate subscription.' };
      }
    }

    // Print order: hand fulfilment to the background function and ack Stripe
    // immediately. Prodigi's order-create can take a long time; blocking the
    // webhook on it makes Stripe time out and retry. The async invoke returns
    // as soon as the job is queued. If queueing itself fails, return 500 so
    // Stripe re-delivers (the fulfilment fn is idempotent on the PrintOrder).
    if (session.metadata?.kind === 'prints') {
      try {
        await lambda.send(
          new InvokeCommand({
            FunctionName: PRINT_FULFILL_FUNCTION,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify({ session })),
          }),
        );
      } catch (err) {
        console.error('Failed to enqueue print fulfillment', err);
        return { statusCode: 500, body: 'Failed to enqueue print fulfillment.' };
      }
    }
  }

  // Corporate subscription lifecycle: keep the CorporateSubscription row in sync
  // so the app knows who is an active corporate customer and when their download
  // grace ends.
  if (
    stripeEvent.type === 'customer.subscription.created' ||
    stripeEvent.type === 'customer.subscription.updated' ||
    stripeEvent.type === 'customer.subscription.deleted'
  ) {
    try {
      await upsertCorporateSubscription(stripeEvent.data.object as Stripe.Subscription);
    } catch (err) {
      console.error('Failed to update corporate subscription', err);
      return { statusCode: 500, body: 'Failed to update subscription.' };
    }
  }

  // Acknowledge every other event type so Stripe stops retrying it.
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
