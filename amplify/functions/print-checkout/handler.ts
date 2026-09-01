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
const PRINT_MARGIN_TARGET = 0.5;
const PRINT_MIN_PROFIT = 1.5;
const PRINT_MAX_PROFIT = 10;
const PRINT_HIGH_BASE = 100;
const PRINT_MAX_PROFIT_HIGH = 20;
const STRIPE_PCT = 0.029;
type Prod = { name: string; size: string; baseCost: number; shipFirst: number; shipAdd: number };
const PRINT_PRODUCTS: Record<string, Prod> = {
  'GLOBAL-PHO-4X6': { name: 'Photo print', size: '4×6 in', baseCost: 0.15, shipFirst: 8.95, shipAdd: 0 },
  'GLOBAL-PHO-5X7': { name: 'Photo print', size: '5×7 in', baseCost: 0.65, shipFirst: 8.95, shipAdd: 0 },
  'GLOBAL-PHO-8X10': { name: 'Photo print', size: '8×10 in', baseCost: 2.0, shipFirst: 9.95, shipAdd: 0 },
  'GLOBAL-FAP-11X14': { name: 'Fine-art print', size: '11×14 in', baseCost: 12.0, shipFirst: 9.95, shipAdd: 0 },
  'GLOBAL-CFP-12X16': { name: 'Framed print', size: '12×16 in', baseCost: 39.0, shipFirst: 20.0, shipAdd: 12.0 },
};

// Net profit per print: 50% of base, clamped so a single cheap print never
// loses money and profit never exceeds $10 ($20 for base over $100).
function profit(baseCost: number): number {
  const cap = baseCost > PRINT_HIGH_BASE ? PRINT_MAX_PROFIT_HIGH : PRINT_MAX_PROFIT;
  return Math.min(cap, Math.max(PRINT_MIN_PROFIT, baseCost * PRINT_MARGIN_TARGET));
}

// Price grosses the net profit up by Stripe's percentage so it survives the fee.
function unitPriceCents(baseCost: number): number {
  const grossed = (baseCost + profit(baseCost)) / (1 - STRIPE_PCT);
  return Math.round((Math.round(grossed * 20) / 20) * 100);
}

// Order shipping at Prodigi's real cost: first-item + plus-one per extra item.
// Uses the max first/plus-one across products so a mixed order is never
// undercharged (single-product orders — what the UI sends — are exact).
function shippingCents(maxShipFirst: number, maxShipAdd: number, totalCopies: number): number {
  const extras = Math.max(0, totalCopies - 1);
  return Math.round((maxShipFirst + maxShipAdd * extras) * 100);
}

// Videos can't be printed; reject them so an order never references one.
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|3gp|hevc)$/i;

// Guardrails. These aren't about profit (bigger orders are more profitable —
// extra prints ship free); they bound worst-case exposure on a single order,
// since a fraudulent/disputed order means physical goods already printed and
// shipped that can't be recovered. The order-total cap is the real financial
// ceiling; the photo/copy caps stop a crafted request building an absurd order.
const MAX_PHOTOS_PER_ORDER = 100;
const MAX_COPIES_PER_ITEM = 50;
const MAX_ORDER_TOTAL_CENTS = 50000; // $500 — raise if you sell large wall-art sets

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

  // Gate. The host can order prints on any plan; guests can only once the
  // event's guest-download add-on has been purchased. Also confirm the event
  // exists and is paid (active) before we take any money.
  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  const eventItem = found.Item;
  if (!eventItem) throw new Error('We couldn’t find that event.');
  if (eventItem.paid?.BOOL === false) {
    throw new Error('This event isn’t active yet.');
  }
  // Anyone who can reach the event's gallery may order prints of it. This used
  // to require the guest-download add-on, but downloads now ship with every
  // plan — and leaving the check in place would have silently ended guest print
  // orders, since the flag it read can no longer be set by anyone.
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
  if (requested.length > MAX_PHOTOS_PER_ORDER) {
    throw new Error(`A single order can include up to ${MAX_PHOTOS_PER_ORDER} photos.`);
  }

  const prefix = `events/${eventId}/`;
  const snapshot: Array<{
    sku: string;
    name: string;
    size: string;
    copies: number;
    s3Key: string;
    photoId: string;
    unitPriceCents: number;
  }> = [];
  // Group copies by SKU so each distinct size is one Stripe line item (quantity =
  // total copies), rather than one line item per photo — that keeps the Stripe
  // session small no matter how many photos are ordered. Per-photo detail still
  // rides in `snapshot` for the Prodigi order.
  const bySku = new Map<string, { product: Prod; qty: number; priceCents: number }>();
  let totalCopies = 0;
  let itemsSubtotalCents = 0;
  let maxShipFirst = 0;
  let maxShipAdd = 0;

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
    const group = bySku.get(item.sku) ?? { product, qty: 0, priceCents };
    group.qty += copies;
    bySku.set(item.sku, group);
    snapshot.push({
      sku: item.sku,
      name: product.name,
      size: product.size,
      copies,
      s3Key,
      photoId: String(item?.photoId ?? ''),
      unitPriceCents: priceCents,
    });
    totalCopies += copies;
    itemsSubtotalCents += priceCents * copies;
    maxShipFirst = Math.max(maxShipFirst, product.shipFirst);
    maxShipAdd = Math.max(maxShipAdd, product.shipAdd);
  }

  const shipCents = shippingCents(maxShipFirst, maxShipAdd, totalCopies);

  // Financial guardrail: bound worst-case loss on a single (possibly fraudulent)
  // order of physical goods.
  if (itemsSubtotalCents + shipCents > MAX_ORDER_TOTAL_CENTS) {
    throw new Error(
      `This order exceeds the $${MAX_ORDER_TOTAL_CENTS / 100} per-order limit. Please split it into smaller orders.`,
    );
  }

  // One Stripe line item per distinct size (collapsed), quantity = total copies.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [...bySku.values()].map(
    ({ product, qty, priceCents }) => ({
      quantity: qty,
      price_data: {
        currency: 'usd',
        unit_amount: priceCents,
        product_data: { name: `${product.name} ${product.size} — ${eventName}` },
      },
    }),
  );

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
            fixed_amount: { amount: shipCents, currency: 'usd' },
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
