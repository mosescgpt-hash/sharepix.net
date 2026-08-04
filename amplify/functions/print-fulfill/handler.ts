// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});
const PRINT_ORDER_TABLE = process.env.PRINT_ORDER_TABLE_NAME as string;
const BUCKET = process.env.BUCKET_NAME as string;

// Prodigi fetches the print asset shortly after the order is placed, so a
// couple of days of validity on the signed URL is ample.
const PRINT_ASSET_URL_TTL_SECONDS = 48 * 60 * 60;

function prodigiBaseUrl(): string {
  return process.env.PRODIGI_ENV === 'live'
    ? 'https://api.prodigi.com'
    : 'https://api.sandbox.prodigi.com';
}

// Prodigi requires product-specific attributes on each order item, keyed by SKU.
// Photo prints (C-type) require a paper `finish` (valid: "lustre" | "gloss");
// the classic framed print requires a frame `color`. Looked up here (not from
// the stored order) so resending an older order still gets them.
const PRODUCT_ATTRIBUTES: Record<string, Record<string, string>> = {
  'GLOBAL-PHO-4X6': { finish: 'lustre' },
  'GLOBAL-PHO-5X7': { finish: 'lustre' },
  'GLOBAL-PHO-8X10': { finish: 'lustre' },
  'GLOBAL-CFP-12X16': { color: 'black' },
};

/**
 * Submit a paid print order to Prodigi. Reads the PrintOrder row by id,
 * regenerates a signed URL for each photo from its stored s3Key, and posts the
 * order with the shipping address Stripe collected. Idempotent: skipped if the
 * row is already `submitted`, so a duplicate invocation can't double-order.
 */
async function fulfillPrintOrder(session) {
  const printOrderId = session.metadata?.printOrderId;
  if (!printOrderId) return;

  const found = await dynamo.send(
    new GetItemCommand({ TableName: PRINT_ORDER_TABLE, Key: { id: { S: printOrderId } } }),
  );
  const order = found.Item;
  if (!order) {
    console.error('Print order not found', printOrderId);
    return;
  }
  if (order.status?.S === 'submitted') return; // already fulfilled

  const now = new Date().toISOString();
  const items = JSON.parse(order.itemsJson?.S ?? '[]');

  // Shipping details: Stripe exposes these as `shipping_details` (older API) or
  // `collected_information.shipping_details` (newer). Fall back to the customer.
  const shipping =
    session.shipping_details ?? session.collected_information?.shipping_details ?? null;
  const addr = shipping?.address ?? session.customer_details?.address ?? {};
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

  // Every entry here is referenced by both the success and failure updates below
  // (DynamoDB rejects an ExpressionAttributeValues key that no expression uses).
  const shippingAttrs = {
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

  // Prodigi's order-create can take a long time (it validates the photo asset).
  // We're in a background invocation, not the webhook, so we can afford to wait —
  // bound at 100s, below the function's 120s timeout, so an abort is a clean error.
  console.log('Prodigi POST starting', printOrderId, 'items:', prodigiItems.length);
  const startedAt = Date.now();
  const response = await fetch(`${prodigiBaseUrl()}/v4.0/Orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(100000),
  });
  console.log('Prodigi POST responded', printOrderId, response.status, `${Date.now() - startedAt}ms`);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
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

  const result = (await response.json().catch(() => ({}))) ?? {};
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

/** Invoked asynchronously by the Stripe webhook with { session }. */
export const handler = async (event) => {
  const session = event?.session;
  if (!session) {
    console.error('print-fulfill invoked without a session');
    return;
  }
  try {
    await fulfillPrintOrder(session);
  } catch (err) {
    console.error('Failed to submit print order', err);
    // Record the failure so it's visible instead of silently lost.
    const printOrderId = session?.metadata?.printOrderId;
    if (printOrderId) {
      await dynamo
        .send(
          new UpdateItemCommand({
            TableName: PRINT_ORDER_TABLE,
            Key: { id: { S: printOrderId } },
            UpdateExpression: 'SET #status = :failed, #error = :error, updatedAt = :now',
            ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
            ExpressionAttributeValues: {
              ':failed': { S: 'failed' },
              ':error': { S: String(err).slice(0, 900) },
              ':now': { S: new Date().toISOString() },
            },
          }),
        )
        .catch(() => undefined);
    }
  }
};
