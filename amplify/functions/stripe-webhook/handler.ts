// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import Stripe from 'stripe';
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({});
const PAYMENT_TABLE = process.env.PAYMENT_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CORPORATE_TABLE = process.env.CORPORATE_TABLE_NAME as string;

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

    // Apply the event side effect of this payment, if any:
    //  - guest_download add-on → enable guest downloads on the event
    //  - otherwise (event payment) → activate the pending event
    if (eventId) {
      const kind = session.metadata?.kind ?? '';
      const field = kind === 'guest_download' ? 'guestDownloadEnabled' : 'paid';
      try {
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
      } catch (err) {
        // A missing event (e.g. deleted before payment) shouldn't fail the
        // webhook — the payment is still recorded. Retry-worthy errors surface.
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') {
          console.error('Failed to apply event payment', err);
          return { statusCode: 500, body: 'Failed to apply event payment.' };
        }
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
