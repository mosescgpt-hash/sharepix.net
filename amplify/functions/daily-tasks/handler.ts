// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { randomBytes } from 'node:crypto';
import { dueReminder, formatExpiryDate, lapsedReminders, reminderKey } from './eventReminders';
import { mayReceive, preferenceKey } from './emailPreferences';
import { buildExpiryMessage, galleryExpiresAt } from './expiryMessage';

const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const NOTIFICATION_TABLE = process.env.NOTIFICATION_TABLE_NAME as string;
const PREFERENCE_TABLE = process.env.PREFERENCE_TABLE_NAME as string;
const APP_URL = (process.env.APP_URL ?? 'https://www.sharepix.net').replace(/\/+$/, '');
const FROM_ADDRESS = process.env.ALERT_FROM_ADDRESS ?? '';
const REPLY_TO = process.env.ALERT_REPLY_TO ?? '';

/**
 * The master switch on actually sending anything.
 *
 * Unset means the job runs completely — scans, decides, logs every recipient
 * and subject — and sends nothing. That is deliberate and it is how a job that
 * mails real customers gets observed in production before it is trusted. The
 * alternative is discovering from a customer that it addresses everyone as
 * "undefined".
 *
 * Nothing is recorded as sent in dry-run either, so switching it on later sends
 * the reminders that were due rather than skipping them as already done.
 */
const SENDING_ENABLED = (process.env.EMAIL_SENDING_ENABLED ?? '').toLowerCase() === 'true';

/** Bound the work one run will do, so a bad day cannot become a bad month. */
const MAX_SENDS_PER_RUN = 200;

interface EventRow {
  id: string;
  name: string;
  tier: string;
  alertEmail: string;
  uploadWindowEndsAt: string | null;
  paid: boolean;
}

function readEvent(item: Record<string, AttributeValue>): EventRow {
  return {
    id: item.id?.S ?? '',
    name: item.name?.S ?? '',
    tier: item.tier?.S ?? '',
    alertEmail: item.alertEmail?.S ?? '',
    uploadWindowEndsAt: item.uploadWindowEndsAt?.S ?? null,
    paid: item.paid?.BOOL !== false,
  };
}

/**
 * Every event, a page at a time.
 *
 * A scan, and honestly so. There is no index that answers "expiring soon" —
 * the expiry date is derived from the window plus the plan's retention rather
 * than stored — and building one would mean maintaining a computed field on
 * every event row through every extension and plan change. At this size a
 * nightly scan costs cents. If the table ever grows enough for that to be the
 * wrong call, the fix is a stored expiry date with a GSI, not a bigger scan.
 */
async function* allEvents(): AsyncGenerator<EventRow> {
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: EVENT_TABLE,
        ExclusiveStartKey: startKey,
        ProjectionExpression: '#id, #name, tier, alertEmail, uploadWindowEndsAt, paid',
        // `name` is reserved in DynamoDB expressions, and `id` is safest aliased.
        ExpressionAttributeNames: { '#id': 'id', '#name': 'name' },
      }),
    );
    for (const item of page.Items ?? []) yield readEvent(item);
    startKey = page.LastEvaluatedKey;
  } while (startKey);
}

/** Which milestones this event has already been through, sent or lapsed. */
async function sentMilestones(eventId: string): Promise<number[]> {
  if (!NOTIFICATION_TABLE) return [];
  const found: number[] = [];
  for (const days of [60, 30, 7]) {
    const row = await dynamo
      .send(
        new GetItemCommand({
          TableName: NOTIFICATION_TABLE,
          Key: { id: { S: reminderKey(eventId, days) } },
          ProjectionExpression: 'id',
        }),
      )
      .catch(() => null);
    if (row?.Item) found.push(days);
  }
  return found;
}

/**
 * Claim a milestone before sending it.
 *
 * The conditional put is the idempotency: a job that double-fires, or retries
 * after timing out halfway through a batch, cannot send the same reminder
 * twice. Claiming BEFORE the send means a crash between the two costs a
 * reminder rather than duplicating one — and of those two failures, the silent
 * duplicate is the one that makes people distrust every message after it.
 */
async function claimMilestone(
  eventId: string,
  days: number,
  outcome: 'sent' | 'lapsed',
  nowISO: string,
): Promise<boolean> {
  if (!NOTIFICATION_TABLE) return false;
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: NOTIFICATION_TABLE,
        Item: {
          id: { S: reminderKey(eventId, days) },
          __typename: { S: 'EventNotification' },
          eventId: { S: eventId },
          kind: { S: `gallery-expiry-${days}` },
          outcome: { S: outcome },
          sentAt: { S: nowISO },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    console.error('Could not claim a reminder milestone', {
      at: nowISO,
      eventId,
      days,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * The stored preferences for an address, creating the row on first contact.
 *
 * The row has to exist before the first send because it carries the random
 * token an unsubscribe link needs. Created with a conditional put so two
 * events belonging to the same host in one run cannot race to mint two tokens.
 */
async function preferencesFor(
  email: string,
  nowISO: string,
): Promise<{ unsubscribedAt: string | null; token: string } | null> {
  const key = preferenceKey(email);
  if (!key || !PREFERENCE_TABLE) return null;

  const existing = await dynamo
    .send(
      new GetItemCommand({
        TableName: PREFERENCE_TABLE,
        Key: { id: { S: key } },
      }),
    )
    .catch(() => null);

  if (existing?.Item) {
    return {
      unsubscribedAt: existing.Item.unsubscribedAt?.S ?? null,
      token: existing.Item.unsubscribeToken?.S ?? '',
    };
  }

  const token = randomBytes(24).toString('hex');
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: PREFERENCE_TABLE,
        Item: {
          id: { S: key },
          __typename: { S: 'EmailPreference' },
          email: { S: key },
          unsubscribeToken: { S: token },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
    return { unsubscribedAt: null, token };
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      // Lost the race to another event in this same run; read what won.
      const won = await dynamo
        .send(new GetItemCommand({ TableName: PREFERENCE_TABLE, Key: { id: { S: key } } }))
        .catch(() => null);
      return won?.Item
        ? {
            unsubscribedAt: won.Item.unsubscribedAt?.S ?? null,
            token: won.Item.unsubscribeToken?.S ?? '',
          }
        : null;
    }
    console.error('Could not read or create an email preference', {
      at: nowISO,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function markSent(email: string, nowISO: string): Promise<void> {
  const key = preferenceKey(email);
  if (!key || !PREFERENCE_TABLE) return;
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: PREFERENCE_TABLE,
        Key: { id: { S: key } },
        UpdateExpression: 'SET lastSentAt = :now, updatedAt = :now',
        ExpressionAttributeValues: { ':now': { S: nowISO } },
      }),
    )
    .catch(() => undefined);
}

async function send(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!FROM_ADDRESS) return false;
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [to] },
        ReplyToAddresses: REPLY_TO ? [REPLY_TO] : undefined,
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: html, Charset: 'UTF-8' },
              Text: { Data: text, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    return true;
  } catch (error) {
    console.error('Could not send an email', {
      at: new Date().toISOString(),
      // The address is deliberately not logged: these logs are read by more
      // people than the mail is sent to.
      subject,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * One nightly pass: warn hosts whose galleries are closing.
 *
 * Every failure is per-event. One malformed row, one bounced address or one
 * SES throttle must not stop the other ninety-nine hosts being told their
 * photos are about to be deleted.
 */
export const handler = async () => {
  const now = new Date();
  const nowISO = now.toISOString();
  let considered = 0;
  let sent = 0;
  let lapsed = 0;
  let skipped = 0;

  for await (const event of allEvents()) {
    if (sent >= MAX_SENDS_PER_RUN) {
      console.warn('Reached the per-run send cap; remaining events wait for tomorrow', {
        at: nowISO,
        cap: MAX_SENDS_PER_RUN,
      });
      break;
    }

    // An unpaid event was never activated, so there is nothing to lose and
    // nobody expecting to keep it.
    if (!event.id || !event.paid) continue;
    considered += 1;

    const expiresAt = galleryExpiresAt(event.uploadWindowEndsAt, event.tier);
    if (!expiresAt) continue;

    let already: number[] = [];
    try {
      already = await sentMilestones(event.id);
    } catch {
      continue;
    }

    // Milestones that went by while nothing was running. Recorded, never sent:
    // "60 days left" delivered to an event with nine is worse than silence.
    for (const days of lapsedReminders(expiresAt, now, already)) {
      if (await claimMilestone(event.id, days, 'lapsed', nowISO)) {
        already.push(days);
        lapsed += 1;
      }
    }

    const due = dueReminder(expiresAt, now, already);
    if (!due) continue;

    const to = event.alertEmail;
    const preference = await preferencesFor(to, nowISO);
    // Essential mail, so an opt-out does not apply — but an unusable address
    // still does. mayReceive is the single place that decision lives.
    if (!mayReceive(to, 'gallery-expiry', preference)) {
      skipped += 1;
      continue;
    }

    const message = buildExpiryMessage({
      eventName: event.name,
      expiresOn: formatExpiryDate(due.expiresAt),
      daysRemaining: due.daysRemaining,
      galleryUrl: `${APP_URL}/event/${event.id}/admin`,
      canExtend: event.tier !== 'free',
    });

    if (!SENDING_ENABLED) {
      // Dry run: log the decision, claim nothing. Turning sending on later
      // therefore sends what was due rather than skipping it as done.
      console.log('[dry-run] would send gallery expiry reminder', {
        at: nowISO,
        eventId: event.id,
        daysBefore: due.daysBefore,
        subject: message.subject,
      });
      skipped += 1;
      continue;
    }

    if (!(await claimMilestone(event.id, due.daysBefore, 'sent', nowISO))) {
      // Another run already has this one.
      continue;
    }
    if (await send(to, message.subject, message.html, message.text)) {
      await markSent(to, nowISO);
      sent += 1;
    }
  }

  const summary = { at: nowISO, considered, sent, lapsed, skipped, dryRun: !SENDING_ENABLED };
  console.log('Daily tasks complete', summary);
  return summary;
};
