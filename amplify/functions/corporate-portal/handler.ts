// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import Stripe from 'stripe';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const CORP_TABLE = process.env.CORPORATE_TABLE_NAME as string;

type Handler = Schema['openBillingPortal']['functionHandler'];

export const handler: Handler = async (event) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey || !secretKey.startsWith('sk_')) {
    throw new Error('Stripe is not configured.');
  }

  // Identify the caller from their verified token — never trust client input.
  const userId = event.identity?.sub;
  if (!userId) throw new Error('You must be signed in.');

  const found = await dynamo.send(
    new GetItemCommand({ TableName: CORP_TABLE, Key: { userId: { S: userId } } }),
  );
  const customerId = found.Item?.stripeCustomerId?.S;
  if (!customerId) {
    throw new Error('No subscription was found for your account.');
  }

  const appUrl = process.env.APP_URL ?? 'https://www.sharepix.net';
  const stripe = new Stripe(secretKey);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/corporate`,
  });

  return { url: session.url };
};
