import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { buildReminderMessage, formatCloseDate } from './message';
import { dueReminder, purgeDue, zoneFor, type ReminderEvent, type ReminderKind } from './rules';

const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const OPT_IN_TABLE = process.env.REMINDER_OPT_IN_TABLE_NAME as string;
const APP_URL = (process.env.APP_URL ?? 'https://www.sharepix.net').replace(/\/+$/, '');
const FROM_ADDRESS = process.env.REMINDER_FROM_ADDRESS || 'SharePix <noreply@sharepix.net>';
const REPLY_TO = process.env.REMINDER_REPLY_TO || 'support@sharepix.net';
/** The same master switch as the host mail. Unset: decide and log, send nothing. */
const SENDING_ENABLED = (process.env.EMAIL_SENDING_ENABLED ?? '').toLowerCase() === 'true';
/** Bound one run, so a bad hour cannot become a bad day. */
const MAX_SENDS_PER_RUN = 500;

interface JobResult {
  ok: boolean;
  dryRun: boolean;
  summary: string;
}

interface EventInfo {
  rules: ReminderEvent;
  name: string;
}

interface OptInRow {
  id: string;
  eventId: string;
  email: string;
  token: string;
  createdAt: string;
  firstSentAt: string | null;
  secondSentAt: string | null;
  unsubscribed: boolean;
}

function readOptIn(item: Record<string, AttributeValue>): OptInRow {
  return {
    id: item.id?.S ?? '',
    eventId: item.eventId?.S ?? '',
    email: item.email?.S ?? '',
    token: item.unsubscribeToken?.S ?? '',
    createdAt: item.createdAt?.S ?? '',
    firstSentAt: item.firstSentAt?.S ?? null,
    secondSentAt: item.secondSentAt?.S ?? null,
    unsubscribed: item.unsubscribed?.BOOL === true,
  };
}

async function loadEvent(eventId: string): Promise<EventInfo | null> {
  const found = await dynamo.send(
    new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }),
  );
  const item = found.Item;
  if (!item) return null;
  return {
    name: item.name?.S ?? '',
    rules: {
      date: item.date?.S ?? null,
      uploadWindowEndsAt: item.uploadWindowEndsAt?.S ?? null,
      timeZone: item.timeZone?.S ?? null,
      uploadRemindersEnabled: item.uploadRemindersEnabled?.BOOL ?? null,
      uploadsClosed: item.uploadsClosed?.BOOL ?? null,
      paid: item.paid?.BOOL ?? null,
      takenDownAt: item.takenDownAt?.S ?? null,
    },
  };
}

const sentField = (kind: ReminderKind) => (kind === 'first' ? 'firstSentAt' : 'secondSentAt');

/**
 * Claim a send before making it: a run that overlaps another, or a retry,
 * finds the claim and sends nothing. At most once, by design — a reminder
 * that is lost to an SES error is released below and retried next hour.
 */
async function claim(id: string, kind: ReminderKind, nowISO: string): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: OPT_IN_TABLE,
        Key: { id: { S: id } },
        UpdateExpression: 'SET #sent = :now, updatedAt = :now',
        ConditionExpression:
          'attribute_exists(id) AND attribute_not_exists(#sent) AND (attribute_not_exists(unsubscribed) OR unsubscribed = :false)',
        ExpressionAttributeNames: { '#sent': sentField(kind) },
        ExpressionAttributeValues: { ':now': { S: nowISO }, ':false': { BOOL: false } },
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
}

async function release(id: string, kind: ReminderKind): Promise<void> {
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: OPT_IN_TABLE,
        Key: { id: { S: id } },
        UpdateExpression: 'REMOVE #sent',
        ExpressionAttributeNames: { '#sent': sentField(kind) },
      }),
    )
    .catch((error) => console.error('Could not release a reminder claim', { id, error: String(error) }));
}

async function send(row: OptInRow, kind: ReminderKind, event: EventInfo): Promise<boolean> {
  const unsubscribeUrl = `${APP_URL}/reminders/stop?r=${row.id}&t=${row.token}`;
  const message = buildReminderMessage({
    kind,
    eventName: event.name,
    uploadUrl: `${APP_URL}/event/${row.eventId}/upload`,
    unsubscribeUrl,
    closesOn: formatCloseDate(event.rules.uploadWindowEndsAt, zoneFor(event.rules)),
  });
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_ADDRESS,
        Destination: { ToAddresses: [row.email] },
        ReplyToAddresses: [REPLY_TO],
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
            // Lets mail apps show their own unsubscribe button. The link,
            // not one-click POST: that needs a public HTTPS endpoint this
            // app does not have.
            Headers: [{ Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` }],
          },
        },
      }),
    );
    return true;
  } catch (error) {
    // The address is deliberately not logged.
    console.error('Could not send a reminder', {
      eventId: row.eventId,
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function run(): Promise<JobResult> {
  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const events = new Map<string, EventInfo | null>();
  const counts = { sent: 0, wouldSend: 0, failed: 0, purged: 0, skippedOverCap: 0 };

  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: OPT_IN_TABLE,
        ExclusiveStartKey: startKey,
      }),
    );
    startKey = page.LastEvaluatedKey;

    for (const item of page.Items ?? []) {
      const row = readOptIn(item);
      if (!events.has(row.eventId)) events.set(row.eventId, await loadEvent(row.eventId).catch(() => null));
      const event = events.get(row.eventId) ?? null;

      // Forget the address once it can no longer be useful: the event is gone,
      // or its window closed more than 30 days ago. Not gated on sending.
      if (!event || purgeDue(event.rules.uploadWindowEndsAt, now)) {
        try {
          await dynamo.send(new DeleteItemCommand({ TableName: OPT_IN_TABLE, Key: { id: { S: row.id } } }));
          counts.purged += 1;
        } catch (error) {
          console.error('Could not delete an opt-in', { id: row.id, error: String(error) });
        }
        continue;
      }

      const kind = dueReminder(event.rules, row, now);
      if (!kind) continue;
      if (counts.sent + counts.wouldSend >= MAX_SENDS_PER_RUN) {
        counts.skippedOverCap += 1;
        continue;
      }
      if (!SENDING_ENABLED) {
        // Nothing is claimed in a dry run, so turning sending on later sends
        // what was due rather than treating it as done.
        counts.wouldSend += 1;
        console.log('Would send an upload reminder', { eventId: row.eventId, kind });
        continue;
      }
      if (!(await claim(row.id, kind, nowISO))) continue;
      if (await send(row, kind, event)) {
        counts.sent += 1;
      } else {
        counts.failed += 1;
        await release(row.id, kind);
      }
    }
  } while (startKey);

  const parts = SENDING_ENABLED
    ? [`Sent ${counts.sent} reminder${counts.sent === 1 ? '' : 's'}.`]
    : [`Nothing was sent: EMAIL_SENDING_ENABLED is off. ${counts.wouldSend} would have gone out.`];
  if (counts.failed) parts.push(`${counts.failed} failed and will retry next hour.`);
  if (counts.skippedOverCap) parts.push(`${counts.skippedOverCap} held for the next run (per-run cap).`);
  parts.push(`Deleted ${counts.purged} expired opt-in${counts.purged === 1 ? '' : 's'}.`);
  const summary = parts.join(' ');
  console.log('send-upload-reminders', { ...counts, sendingEnabled: SENDING_ENABLED });
  return { ok: counts.failed === 0, dryRun: !SENDING_ENABLED, summary };
}

interface InvocationEvent {
  arguments?: { probe?: boolean | null };
  info?: { fieldName?: string };
}

/** Invoked hourly by the schedule, and by runUploadReminders from the admin dashboard. */
export const handler = async (event: InvocationEvent): Promise<JobResult> => {
  // The probe answers before any work, as on the other job runners.
  if (event?.info?.fieldName === 'runUploadReminders' && event.arguments?.probe) {
    return {
      ok: true,
      dryRun: !SENDING_ENABLED,
      summary: SENDING_ENABLED ? 'Guest reminder sending is ON.' : 'Guest reminder sending is OFF.',
    };
  }
  try {
    return await run();
  } catch (error) {
    console.error('send-upload-reminders failed', error);
    return {
      ok: false,
      dryRun: !SENDING_ENABLED,
      summary: `The run stopped: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};
