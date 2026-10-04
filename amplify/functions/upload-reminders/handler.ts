import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  MAX_OPT_INS_PER_EVENT,
  isValidEmail,
  isValidTimeZone,
  normalizeEmail,
  reminderOffer,
  type ReminderEvent,
} from './rules';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const OPT_IN_TABLE = process.env.REMINDER_OPT_IN_TABLE_NAME as string;

interface Result {
  ok: boolean;
  message: string;
}

interface ResolverEvent {
  arguments?: Record<string, unknown>;
  identity?: { sub?: string; groups?: string[] | null } | null;
  info?: { fieldName?: string };
}

/** The id of a guest's opt-in: one per address per event, by construction. */
export function optInId(eventId: string, email: string): string {
  return createHash('sha256').update(`${eventId}#${email}`).digest('hex');
}

function readEvent(item: Record<string, AttributeValue>): ReminderEvent {
  return {
    date: item.date?.S ?? null,
    uploadWindowEndsAt: item.uploadWindowEndsAt?.S ?? null,
    timeZone: item.timeZone?.S ?? null,
    uploadRemindersEnabled: item.uploadRemindersEnabled?.BOOL ?? null,
    uploadsClosed: item.uploadsClosed?.BOOL ?? null,
    paid: item.paid?.BOOL ?? null,
    takenDownAt: item.takenDownAt?.S ?? null,
  };
}

async function getEvent(eventId: string) {
  if (!eventId) return null;
  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  return found?.Item ?? null;
}

const isConditionFailure = (error: unknown) =>
  (error as { name?: string })?.name === 'ConditionalCheckFailedException';

// ---------------------------------------------------------------------------
// requestUploadReminder — a guest, signed out
// ---------------------------------------------------------------------------

const NOT_OFFERED = 'Reminders aren’t available for this event right now.';

async function requestReminder(args: Record<string, unknown>): Promise<Result> {
  const eventId = String(args.eventId ?? '');
  const email = normalizeEmail(args.email);
  if (!isValidEmail(email)) return { ok: false, message: 'That doesn’t look like an email address.' };

  const item = await getEvent(eventId);
  if (!item) return { ok: false, message: NOT_OFFERED };
  const now = Date.now();
  const offer = reminderOffer(readEvent(item), now);
  if (!offer) return { ok: false, message: NOT_OFFERED };

  const id = optInId(eventId, email);
  const nowISO = new Date(now).toISOString();

  // Count against the event's ceiling first. A failed opt-in write below gives
  // the slot back; a duplicate does too, since it added nobody.
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'ADD reminderOptInCount :one',
        ConditionExpression:
          'attribute_exists(id) AND (attribute_not_exists(reminderOptInCount) OR reminderOptInCount < :max)',
        ExpressionAttributeValues: { ':one': { N: '1' }, ':max': { N: String(MAX_OPT_INS_PER_EVENT) } },
      }),
    );
  } catch (error) {
    if (isConditionFailure(error)) return { ok: false, message: NOT_OFFERED };
    throw error;
  }

  const release = () =>
    dynamo
      .send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: 'ADD reminderOptInCount :minus',
          ExpressionAttributeValues: { ':minus': { N: '-1' } },
        }),
      )
      .catch((error) => console.error('Could not release an opt-in slot', { eventId, error: String(error) }));

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: OPT_IN_TABLE,
        Item: {
          id: { S: id },
          __typename: { S: 'ReminderOptIn' },
          eventId: { S: eventId },
          email: { S: email },
          unsubscribeToken: { S: randomBytes(32).toString('hex') },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    await release();
    // Already signed up: the same answer as a new sign-up, so this can't be
    // used to learn whether an address is on an event's list.
    if (isConditionFailure(error)) return { ok: true, message: confirmation(offer.kind) };
    throw error;
  }
  return { ok: true, message: confirmation(offer.kind) };
}

function confirmation(kind: 'first' | 'second'): string {
  return kind === 'first'
    ? 'Done. We’ll email you tomorrow morning.'
    : 'Done. We’ll email you a few days before uploads close.';
}

// ---------------------------------------------------------------------------
// stopUploadReminders — the unsubscribe link
// ---------------------------------------------------------------------------

/** One answer for every failure, so the endpoint reveals nothing. */
const BAD_LINK =
  'That link isn’t valid. If you keep getting reminders, email support@sharepix.net and we’ll stop them.';

function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function stopReminders(args: Record<string, unknown>): Promise<Result> {
  const id = String(args.id ?? '');
  const token = String(args.token ?? '');
  if (!/^[0-9a-f]{64}$/.test(id) || !/^[0-9a-f]{64}$/.test(token)) return { ok: false, message: BAD_LINK };

  const found = await dynamo
    .send(new GetItemCommand({ TableName: OPT_IN_TABLE, Key: { id: { S: id } } }))
    .catch(() => null);
  // A row already purged is as good as unsubscribed: nothing will be sent.
  if (!found?.Item) return { ok: true, message: 'You won’t get any more reminders.' };
  if (!tokensMatch(found.Item.unsubscribeToken?.S ?? '', token)) return { ok: false, message: BAD_LINK };

  await dynamo.send(
    new UpdateItemCommand({
      TableName: OPT_IN_TABLE,
      Key: { id: { S: id } },
      UpdateExpression: 'SET unsubscribed = :true, updatedAt = :now',
      ExpressionAttributeValues: { ':true': { BOOL: true }, ':now': { S: new Date().toISOString() } },
    }),
  );
  return { ok: true, message: 'You won’t get any more reminders.' };
}

// ---------------------------------------------------------------------------
// setUploadReminders — the host
// ---------------------------------------------------------------------------

function mayEdit(caller: ResolverEvent['identity'], owner: string): boolean {
  if ((caller?.groups ?? []).includes('ADMINS')) return true;
  const sub = caller?.sub;
  return !!sub && !!owner && owner.split('::')[0] === sub;
}

async function setReminders(args: Record<string, unknown>, identity: ResolverEvent['identity']): Promise<Result> {
  const eventId = String(args.eventId ?? '');
  const item = await getEvent(eventId);
  // One answer for "no such event" and "not yours".
  if (!item || !mayEdit(identity, item.owner?.S ?? '')) {
    return { ok: false, message: 'That event could not be found.' };
  }
  const enabled = args.enabled === true;
  const timeZone = typeof args.timeZone === 'string' ? args.timeZone : '';

  if (enabled && !isValidTimeZone(timeZone) && !isValidTimeZone(item.timeZone?.S)) {
    return { ok: false, message: 'Choose the event’s time zone so reminders go out at 10am there.' };
  }
  if (timeZone && !isValidTimeZone(timeZone)) {
    return { ok: false, message: 'That time zone isn’t one we recognise.' };
  }

  const sets = ['uploadRemindersEnabled = :enabled', 'updatedAt = :now'];
  const values: Record<string, AttributeValue> = {
    ':enabled': { BOOL: enabled },
    ':now': { S: new Date().toISOString() },
  };
  if (timeZone) {
    sets.push('timeZone = :tz');
    values[':tz'] = { S: timeZone };
  }
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeValues: values,
    }),
  );
  return {
    ok: true,
    message: enabled ? 'Guest reminders are on.' : 'Guest reminders are off.',
  };
}

export const handler = async (event: ResolverEvent): Promise<Result> => {
  const args = event.arguments ?? {};
  try {
    switch (event.info?.fieldName) {
      case 'requestUploadReminder':
        return await requestReminder(args);
      case 'stopUploadReminders':
        return await stopReminders(args);
      case 'setUploadReminders':
        return await setReminders(args, event.identity);
      default:
        return { ok: false, message: 'Unknown request.' };
    }
  } catch (error) {
    // Addresses are deliberately never logged.
    console.error('upload-reminders failed', {
      field: event.info?.fieldName,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Something went wrong. Try again in a moment.' };
  }
};
