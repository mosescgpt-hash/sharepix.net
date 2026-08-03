// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import Stripe from 'stripe';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});
const PAYMENT_TABLE = process.env.PAYMENT_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CORPORATE_TABLE = process.env.CORPORATE_TABLE_NAME as string;
const PRINT_ORDER_TABLE = process.env.PRINT_ORDER_TABLE_NAME as string;
const BUCKET = process.env.BUCKET_NAME as string;

const DAY_MS = 24 * 60 * 60 * 1000;

// Prodigi fetches the print asset shortly after the order is placed, so a
// couple of days of validity on the signed URL is ample.
const PRINT_ASSET_URL_TTL_SECONDS = 48 * 60 * 60;

function prodigiBaseUrl(): string {
  return process.env.PRODIGI_ENV === 'live'
    ? 'https://api.prodigi.com'
    : 'https://api.sandbox.prodigi.com';
}

// Prodigi requires product-specific attributes on each order item, keyed by SKU.
// Photo prints (C-type) require a paper `finish` — verified from Prodigi's
// ValidationFailed response (valid values: "lustre" | "gloss"). Looked up here
// (not from the stored order) so resending an older order still gets them.
// NOTE: only the photo prints below are verified. Fine-art/framed SKUs may
// require their own attributes (frame color, mount, glaze, …) — confirm against
// Prodigi's product detail API before relying on those sizes.
const PRODUCT_ATTRIBUTES: Record<string, Record<string, string>> = {
  'GLOBAL-PHO-4X6': { finish: 'lustre' },
  'GLOBAL-PHO-5X7': { finish: 'lustre' },
  'GLOBAL-PHO-8X10': { finish: 'lustre' },
  'GLOBAL-CFP-12X16': { color: 'black' },
};

/**
 * Submit a paid print order to Prodigi. Reads the pending PrintOrder row by id,
 * regenerates a signed URL for each photo from its stored s3Key, and posts the
 * order with the shipping address Stripe collected. Idempotent: a Prodigi
 * submission is skipped if the row is already `submitted`, so a webhook retry
 * can't double-order.
 */
async function fulfillPrintOrder(session: Stripe.Checkout.Session) {
  const printOrderId = session.metadata?.printOrderId;
  if (!printOrderId) return;

  const found = await dynamo.send(
    new GetItemCommand({ TableName: PRINT_ORDER_TABLE, Key: { id: { S: printOrderId } } }),
  );
  const order = found.Item;
  if (!order) {
    console.error('Print order not found for session', printOrderId);
    return;
  }
  if (order.status?.S === 'submitted') return; // already fulfilled

  const now = new Date().toISOString();
  const items = JSON.parse(order.itemsJson?.S ?? '[]') as Array<{
    sku: string;
    copies: number;
    s3Key: string;
    photoId?: string;
  }>;

  // Shipping details: Stripe exposes these as `shipping_details` (older API) or
  // `collected_information.shipping_details` (newer). Fall back to the customer.
  const shipping =
    (session as { shipping_details?: unknown }).shipping_details ??
    (session as { collected_information?: { shipping_details?: unknown } }).collected_information
      ?.shipping_details ??
    null;
  const addr = (shipping?.address ?? session.customer_details?.address ?? {}) as Record<string, string>;
  const name = shipping?.name ?? session.customer_details?.name ?? '';
  const email = session.customer_details?.email ?? session.customer_email ?? '';

  // Build fresh signed URLs Prodigi can pull the originals from.
  const prodigiItems = await Promise.all(
    items.map(async (item) => {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: item.s3Key }),
        { expiresIn: PRINT_ASSET_URL_TTL_SECONDS },
      );
      return {
        merchantReference: item.photoId || undefined,
        sku: item.sku,
        copies: item.copies,
        sizing: 'fillPrintArea',
        attributes: PRODUCT_ATTRIBUTES[item.sku] ?? {},
        assets: [{ printArea: 'default', url }],
      };
    }),
  );

  const body = {
    merchantReference: printOrderId,
    shippingMethod: 'Standard',
    recipient: {
      name,
      email: email || undefined,
      address: {
        line1: addr.line1 ?? '',
        line2: addr.line2 || undefined,
        postalOrZipCode: addr.postal_code ?? '',
        countryCode: addr.country ?? '',
        townOrCity: addr.city ?? '',
        stateOrCounty: addr.state || undefined,
      },
    },
    items: prodigiItems,
  };

  // Snapshot who/where and the paid total onto the order regardless of outcome.
  // Every entry here is referenced by both the success and failure updates below
  // (DynamoDB rejects an ExpressionAttributeValues key that no expression uses).
  const shippingAttrs: Record<string, { S: string } | { N: string }> = {
    ':session': { S: session.id },
    ':amount': { N: String(session.amount_total ?? 0) },
    ':email': { S: email },
    ':shipName': { S: name },
    ':shipJson': { S: JSON.stringify(addr) },
    ':now': { S: now },
  };

  const apiKey = process.env.PRODIGI_API_KEY;
  if (!apiKey) {
    throw new Error('PRODIGI_API_KEY is missing; cannot submit the print order.');
  }

  // Bound the call so a slow/hung Prodigi never lets the Lambda hit its own
  // timeout (which surfaces as an opaque 502) — this throws a catchable error
  // that the handler turns into a clean, logged 500 instead.
  const response = await fetch(`${prodigiBaseUrl()}/v4.0/Orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Paid but rejected: record the failure so an admin can follow up, and ack
    // the webhook (a retry won't fix a rejected payload).
    await dynamo.send(
      new UpdateItemCommand({
        TableName: PRINT_ORDER_TABLE,
        Key: { id: { S: printOrderId } },
        UpdateExpression:
          'SET #status = :failed, stripeSessionId = :session, amountTotal = :amount, customerEmail = :email, shippingName = :shipName, shippingJson = :shipJson, #error = :error, updatedAt = :now',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ...shippingAttrs,
          ':failed': { S: 'failed' },
          ':error': { S: `Prodigi ${response.status}: ${detail}`.slice(0, 900) },
        },
      }),
    );
    console.error('Prodigi rejected print order', printOrderId, response.status, detail);
    return;
  }

  const result = (await response.json().catch(() => ({}))) as {
    order?: { id?: string };
  };
  const prodigiOrderId = result?.order?.id ?? '';

  await dynamo.send(
    new UpdateItemCommand({
      TableName: PRINT_ORDER_TABLE,
      Key: { id: { S: printOrderId } },
      UpdateExpression:
        'SET #status = :submitted, stripeSessionId = :session, amountTotal = :amount, customerEmail = :email, shippingName = :shipName, shippingJson = :shipJson, prodigiOrderId = :pid, updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ...shippingAttrs,
        ':submitted': { S: 'submitted' },
        ':pid': { S: prodigiOrderId },
      },
    }),
  );
  console.log('Prodigi order submitted', printOrderId, 'prodigiOrderId:', prodigiOrderId);
}

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
    //  - extend_window → push the upload window out by 30 days
    //  - guest_download add-on → enable guest downloads on the event
    //  - prints → no event change (handled by fulfillPrintOrder below)
    //  - otherwise (event payment) → activate the pending event
    if (eventId && session.metadata?.kind !== 'prints') {
      const kind = session.metadata?.kind ?? '';
      try {
        if (kind === 'extend_window') {
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
          const field = kind === 'guest_download' ? 'guestDownloadEnabled' : 'paid';
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

    // Print order: submit it to Prodigi now that payment has landed. A failure
    // to reach Prodigi is retry-worthy (return 500 so Stripe re-delivers); a
    // Prodigi *rejection* is recorded as a failed order inside fulfillPrintOrder
    // and acknowledged, since re-delivering the same payload won't help.
    if (session.metadata?.kind === 'prints') {
      try {
        await fulfillPrintOrder(session);
      } catch (err) {
        console.error('Failed to submit print order', err);
        return { statusCode: 500, body: 'Failed to submit print order.' };
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
