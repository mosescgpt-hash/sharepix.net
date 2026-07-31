// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import Stripe from 'stripe';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import type { Schema } from '../../data/resource';

type Handler = Schema['createPrintCheckout']['functionHandler'];

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const PRINT_ORDER_TABLE = process.env.PRINT_ORDER_TABLE_NAME as string;

// Mirrors lib/prints.ts. Kept in sync by hand so this function has no
// cross-bundle imports (same convention as stripe-checkout's TIER_PRICING).
const PRINT_MARGIN = 1.5;
const PRINT_SHIPPING_CENTS = 699;
const PRINT_PRODUCTS: Record<string, { name: string; size: string; baseCost: number }> = {
  'GLOBAL-PHO-6X4': { name: 'Photo print', size: '6×4 in', baseCost: 1.6 },
  'GLOBAL-PHO-7X5': { name: 'Photo print', size: '7×5 in', baseCost: 2.2 },
  'GLOBAL-PHO-10X8': { name: 'Photo print', size: '10×8 in', baseCost: 4.0 },
  'GLOBAL-CAN-16X12': { name: 'Canvas', size: '16×12 in', baseCost: 24.0 },
  'GLOBAL-FAP-16X12': { name: 'Framed print', size: '16×12 in', baseCost: 30.0 },
};

function unitPriceCents(baseCost: number): number {
  return Math.round((Math.round(baseCost * PRINT_MARGIN * 20) / 20) * 100);
}

// Videos can't be printed; reject them so an order never references one.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp|hevc)$/i;

// Sane caps so a crafted request can't create a giant order.
const MAX_LINE_ITEMS = 25;
const MAX_COPIES_PER_ITEM = 50;

export const handler: Handler = async (event) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Stripe is not configured: STRIPE_SECRET_KEY is missing.');
  }
  if (!secretKey.startsWith('sk_')) {
    throw new Error('STRIPE_SECRET_KEY does not look like a secret key (should start with "sk_").');
  }

  const eventId = (event.arguments.eventId ?? '').trim();
  if (!eventId) throw new Error('Missing event for the print order.');

  // Gate: prints are only available on an event whose guest-download add-on has
  // been purchased — the same gate that unlocks downloads. This also confirms
  // the event exists and is paid (active) before we take any money.
  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  const eventItem = found.Item;
  if (!eventItem) throw new Error('We couldn’t find that event.');
  if (eventItem.paid?.BOOL === false) {
    throw new Error('This event isn’t active yet.');
  }
  if (eventItem.guestDownloadEnabled?.BOOL !== true) {
    throw new Error('Prints aren’t enabled for this event.');
  }
  const eventName = eventItem.name?.S ?? 'SharePix event';

  // Parse and validate the requested items.
  let requested: Array<{ sku: string; copies: number; s3Key: string; photoId?: string }>;
  try {
    requested = JSON.parse(event.arguments.itemsJson ?? '[]');
  } catch {
    throw new Error('The print selection could not be read.');
  }
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new Error('Choose at least one photo to print.');
  }
  if (requested.length > MAX_LINE_ITEMS) {
    throw new Error(`A single order can include up to ${MAX_LINE_ITEMS} photos.`);
  }

  const prefix = `events/${eventId}/`;
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const snapshot: Array<{
    sku: string;
    name: string;
    size: string;
    copies: number;
    s3Key: string;
    photoId: string;
    unitPriceCents: number;
  }> = [];

  for (const item of requested) {
    const product = PRINT_PRODUCTS[item?.sku];
    if (!product) throw new Error('One of the print sizes isn’t available.');

    const copies = Math.floor(Number(item?.copies));
    if (!Number.isFinite(copies) || copies < 1 || copies > MAX_COPIES_PER_ITEM) {
      throw new Error('Choose between 1 and 50 copies per photo.');
    }

    const s3Key = String(item?.s3Key ?? '');
    // The photo must live under this event's own storage prefix — the same check
    // createEventPhoto uses to stop a request pointing at another event's files.
    if (!s3Key.startsWith(prefix)) {
      throw new Error('One of the photos does not belong to this event.');
    }
    if (VIDEO_EXT.test(s3Key)) {
      throw new Error('Videos can’t be printed — choose photos only.');
    }

    const priceCents = unitPriceCents(product.baseCost);
    lineItems.push({
      quantity: copies,
      price_data: {
        currency: 'usd',
        unit_amount: priceCents,
        product_data: { name: `${product.name} ${product.size} — ${eventName}` },
      },
    });
    snapshot.push({
      sku: item.sku,
      name: product.name,
      size: product.size,
      copies,
      s3Key,
      photoId: String(item?.photoId ?? ''),
      unitPriceCents: priceCents,
    });
  }

  const printOrderId = randomUUID();
  const now = new Date().toISOString();

  // Persist the order as `pending` before checkout. The webhook reads it back by
  // id (from Stripe metadata) after payment, regenerates signed image URLs from
  // the stored s3Keys, and submits it to Prodigi. Storing keys (not URLs) means
  // no expiring/oversized URL ever has to ride through Stripe metadata.
  await dynamo.send(
    new PutItemCommand({
      TableName: PRINT_ORDER_TABLE,
      Item: {
        id: { S: printOrderId },
        __typename: { S: 'PrintOrder' },
        eventId: { S: eventId },
        status: { S: 'pending' },
        itemsJson: { S: JSON.stringify(snapshot) },
        currency: { S: 'usd' },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
    }),
  );

  const appUrl = process.env.APP_URL ?? 'https://www.sharepix.net';
  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      // Prints are physical goods: collect a shipping address and charge a flat
      // shipping fee. The webhook sends this address to Prodigi.
      shipping_address_collection: {
        allowed_countries: [
          'US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE',
          'SE', 'DK', 'NO', 'FI', 'PT', 'AT', 'CH', 'PL',
        ],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: 'Standard shipping',
            fixed_amount: { amount: PRINT_SHIPPING_CENTS, currency: 'usd' },
          },
        },
      ],
      success_url: `${appUrl}/event/${eventId}?prints=success`,
      cancel_url: `${appUrl}/event/${eventId}?prints=cancelled`,
      metadata: { kind: 'prints', tier: 'prints', eventId, printOrderId },
    });
    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return { url: session.url };
  } catch (error) {
    throw new Error(
      `Stripe print checkout failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
