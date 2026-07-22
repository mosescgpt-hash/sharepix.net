// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import Stripe from 'stripe';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({});
const PAYMENT_TABLE = process.env.PAYMENT_TABLE_NAME as string;

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
  }

  // Acknowledge every other event type so Stripe stops retrying it.
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
