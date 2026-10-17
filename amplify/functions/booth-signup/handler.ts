import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { createHash, randomBytes } from 'node:crypto';
import type { Schema } from '../../data/resource';
import { MAX_ATTENDEES_PER_EVENT, boothOpen, validateSignup } from './signup';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME as string;

type Handler = Schema['boothSignUp']['functionHandler'];

/**
 * One attendee per email per event. The row id is derived from both, so
 * signing up again (a new phone, a lost tab, the kiosk) returns the same QR
 * token instead of creating a second person the photos would be split across.
 */
function attendeeId(eventId: string, email: string): string {
  return `${eventId}#${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
}

/**
 * The QR token. Random and unguessable, and never the email: badge codes get
 * photographed, and a token says nothing on its own.
 */
function newToken(): string {
  return randomBytes(15).toString('base64url');
}

async function existingToken(id: string): Promise<string | null> {
  const found = await dynamo.send(
    new GetItemCommand({
      TableName: ATTENDEE_TABLE,
      Key: { id: { S: id } },
      ProjectionExpression: 'id, #token',
      ExpressionAttributeNames: { '#token': 'token' },
      ConsistentRead: true,
    }),
  );
  return found.Item?.token?.S ?? null;
}

export const handler: Handler = async (event) => {
  const eventId = (event.arguments.eventId ?? '').trim();
  const fail = (message: string) => ({ ok: false, message, token: null, name: null });
  if (!eventId) return fail('Missing event.');

  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  const ev = found.Item;
  if (
    !ev ||
    !boothOpen({
      boothMode: ev.boothMode?.BOOL ?? null,
      paid: ev.paid?.BOOL ?? null,
      takenDownAt: ev.takenDownAt?.S ?? null,
      hostDeletedAt: ev.hostDeletedAt?.S ?? null,
    })
  ) {
    return fail('This event is not taking sign-ups.');
  }

  const checked = validateSignup(event.arguments);
  if (!checked.ok) return fail(checked.reason);
  const { name, email } = checked;
  const id = attendeeId(eventId, email);
  const now = new Date().toISOString();

  // Already signed up: hand back the same token. The stored row is left as it
  // was — typing somebody else's email must not let you rename them.
  const known = await existingToken(id);
  if (known) return { ok: true, message: 'Welcome back.', token: known, name };

  // The event's ceiling, taken atomically before the row is written.
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'ADD boothAttendeeCount :one',
        ConditionExpression: 'attribute_not_exists(boothAttendeeCount) OR boothAttendeeCount < :max',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':max': { N: String(MAX_ATTENDEES_PER_EVENT) },
        },
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return fail('This event has reached its sign-up limit. Please ask the photographer.');
    }
    throw err;
  }

  const token = newToken();
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: ATTENDEE_TABLE,
        Item: {
          id: { S: id },
          __typename: { S: 'BoothAttendee' },
          eventId: { S: eventId },
          // The host's owner string, so they can read their own attendees.
          ...(ev.owner?.S ? { eventOwner: { S: ev.owner.S } } : {}),
          name: { S: name },
          email: { S: email },
          token: { S: token },
          consentedAt: { S: now },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (err) {
    // Two sign-ups with the same email at the same moment: the other one won.
    // Give the count back and hand out the winner's token.
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: 'ADD boothAttendeeCount :neg',
          ExpressionAttributeValues: { ':neg': { N: '-1' } },
        }),
      )
      .catch(() => undefined);
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      const winner = await existingToken(id);
      if (winner) return { ok: true, message: 'Welcome back.', token: winner, name };
    }
    throw err;
  }

  return { ok: true, message: 'You are signed up.', token, name };
};
