import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { randomBytes } from 'node:crypto';
import { dueReminder, formatExpiryDate, lapsedReminders, reminderKey } from './eventReminders';
import { mayReceive, preferenceKey } from './emailPreferences';
import { buildExpiryMessage, galleryExpiresAt } from './expiryMessage';
import { isSuccessfulEvent } from './successfulEvent';
import {
  INCENTIVE_AMOUNT_USD,
  INCENTIVE_TYPE,
  incentiveId,
} from './researchIncentive';
import { encodeSurveyLink } from './surveyLink';
import { SURVEY_VERSION, reminderIsDue, surveyIsDue } from './survey';
import { ANALYTICS_RETENTION_DAYS, isExpiredAnalytics } from './analytics';
import { encodeRatingLink } from './ratingLink';

const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const NOTIFICATION_TABLE = process.env.NOTIFICATION_TABLE_NAME as string;
const PREFERENCE_TABLE = process.env.PREFERENCE_TABLE_NAME as string;
const INCENTIVE_TABLE = process.env.INCENTIVE_TABLE_NAME as string;
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE_NAME as string;
const SURVEY_TABLE = process.env.SURVEY_TABLE_NAME as string;
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME ?? '';
/**
 * Which survey they were asked. A second survey is a second programme.
 *
 * There is no longer a URL beside this. The survey is a page in this
 * application, so there is nothing to configure and nothing that can be
 * misconfigured into mailing people a link to nowhere. When it goes out is in
 * lib/survey.ts, measured from the event rather than from the upload window.
 */
const SURVEY_ID = process.env.RESEARCH_SURVEY_ID ?? 'post-event-v1';
/**
 * Days after the upload window closes before the rating request goes out.
 *
 * Configurable because it is a guess. The brief suggests day +4 measured from
 * the event; this codebase has no reliable event end time, so it is measured
 * from the close of the upload window, which is a date the system actually
 * sets. Asking earlier risks asking while guests are still uploading.
 */
const RATING_DELAY_DAYS = Number(process.env.RATING_DELAY_DAYS ?? '2');
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
  owner: string;
  contributorCount: number;
  guestUploadCount: number;
  /** The host's stated event date, a plain YYYY-MM-DD, or null. */
  date: string | null;
  /** When the event was paid for. Absent on comped and older events. */
  paidAt: string | null;
  createdAt: string | null;
  /** Internal cohort label, e.g. FOUNDING_20. Never shown to a host. */
  internalCohort: string;
  /** What kind of occasion it was, when the event row knows. */
  eventType: string;
  /** Whether an admin chose to offer a gift card for this event's survey. */
  researchIncentiveOffered: boolean;
}

function readEvent(item: Record<string, AttributeValue>): EventRow {
  return {
    id: item.id?.S ?? '',
    name: item.name?.S ?? '',
    tier: item.tier?.S ?? '',
    alertEmail: item.alertEmail?.S ?? '',
    uploadWindowEndsAt: item.uploadWindowEndsAt?.S ?? null,
    paid: item.paid?.BOOL !== false,
    owner: item.owner?.S ?? '',
    contributorCount: Number(item.contributorCount?.N ?? '0'),
    guestUploadCount: Number(item.guestUploadCount?.N ?? '0'),
    date: item.date?.S ?? null,
    paidAt: item.paidAt?.S ?? null,
    createdAt: item.createdAt?.S ?? null,
    internalCohort: item.internalCohort?.S ?? '',
    eventType: item.eventType?.S ?? '',
    researchIncentiveOffered: item.researchIncentiveOffered?.BOOL === true,
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
        ProjectionExpression:
          '#id, #name, tier, alertEmail, uploadWindowEndsAt, paid, #owner, contributorCount, guestUploadCount, #date, paidAt, createdAt, internalCohort, eventType, researchIncentiveOffered',
        // `name`, `owner` and `date` are reserved in DynamoDB expressions; `id`
        // is safest aliased alongside them.
        ExpressionAttributeNames: {
          '#id': 'id',
          '#name': 'name',
          '#owner': 'owner',
          '#date': 'date',
        },
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

/**
 * Open the gift-card obligation for an event whose invitation offers one.
 *
 * PENDING means "invited, has not completed" — nothing is owed until they
 * answer. The conditional put is the idempotency: one obligation per event per
 * survey, however many times this job runs.
 *
 * Called only when an admin has turned the offer on for this event, and always
 * before the email is sent, so an email promising a gift card cannot go out
 * without the obligation being recorded. If this fails, the invitation is
 * skipped entirely and retried tomorrow — a promise nothing is tracking is
 * worse than a late invitation.
 */
async function openIncentiveObligation(event: EventRow, nowISO: string): Promise<boolean> {
  if (!INCENTIVE_TABLE) return false;
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: INCENTIVE_TABLE,
        Item: {
          id: { S: incentiveId(event.id, SURVEY_ID) },
          __typename: { S: 'ResearchIncentive' },
          customer: { S: event.owner },
          eventId: { S: event.id },
          surveyId: { S: SURVEY_ID },
          participantEmail: { S: event.alertEmail },
          incentiveType: { S: INCENTIVE_TYPE },
          amountUsd: { N: String(INCENTIVE_AMOUNT_USD) },
          status: { S: 'PENDING' },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
    return true;
  } catch (error) {
    // Already recorded, which is the ordinary answer if a previous run opened
    // the obligation and then failed to send.
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return true;
    console.error('Could not open a gift-card obligation', {
      at: nowISO,
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Delete funnel rows older than the retention window.
 *
 * These are the highest-volume rows SharePix stores after media — one per page
 * view — and until now nothing pruned them. At a thousand events a month
 * `homepage_view` alone would outgrow every other table, and the product-health
 * dashboard reads all of them on every load.
 *
 * Milestones are exempt, and a row with no readable timestamp is kept: guessing
 * wrong here destroys evidence rather than saving storage.
 *
 * Bounded per run. A backlog is cleared over several nights rather than in one
 * job that times out halfway and leaves nobody knowing how far it got.
 */
const MAX_ANALYTICS_DELETES_PER_RUN = 5000;

async function pruneAnalytics(now: Date): Promise<number> {
  if (!ANALYTICS_TABLE) return 0;
  let deleted = 0;
  let startKey: Record<string, AttributeValue> | undefined;

  do {
    const page = await dynamo
      .send(
        new ScanCommand({
          TableName: ANALYTICS_TABLE,
          ExclusiveStartKey: startKey,
          ProjectionExpression: '#id, #name, occurredAt',
          ExpressionAttributeNames: { '#id': 'id', '#name': 'name' },
        }),
      )
      .catch(() => null);
    if (!page) return deleted;

    for (const item of page.Items ?? []) {
      if (deleted >= MAX_ANALYTICS_DELETES_PER_RUN) return deleted;
      const id = item.id?.S ?? '';
      if (!id) continue;
      if (!isExpiredAnalytics({ name: item.name?.S ?? '', occurredAt: item.occurredAt?.S ?? null }, now)) {
        continue;
      }
      await dynamo
        .send(new DeleteItemCommand({ TableName: ANALYTICS_TABLE, Key: { id: { S: id } } }))
        .then(() => {
          deleted += 1;
        })
        .catch(() => undefined);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey && deleted < MAX_ANALYTICS_DELETES_PER_RUN);

  if (deleted > 0) {
    console.log('Pruned expired funnel events', {
      at: now.toISOString(),
      deleted,
      retentionDays: ANALYTICS_RETENTION_DAYS,
    });
  }
  return deleted;
}

/**
 * Give every outstanding gift-card invitation a survey row to land on.
 *
 * The research programme used to send people to a form provider and record the
 * obligation in ResearchIncentive; the link they were sent carries that row's
 * token. Now that the survey is part of the product, a link like that resolves
 * against SurveyResponse, finds nothing, and tells a person who was promised
 * twenty-five dollars that their link is invalid.
 *
 * So each PENDING obligation gets a survey row carrying the same token. The
 * link they already have then works, and the promise made to them stands. The
 * conditional put means this is a no-op once done, and it never disturbs a row
 * the new invitation flow created.
 *
 * Nothing here creates new obligations: no gift card is promised by the current
 * invitation email, and nothing opens a ResearchIncentive any more. Existing
 * ones are honoured; the programme is paused rather than retired, and the rows
 * and the admin queue behind it are untouched.
 */
async function backfillResearchInvites(nowISO: string): Promise<number> {
  if (!INCENTIVE_TABLE || !SURVEY_TABLE) return 0;
  let adopted = 0;
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo
      .send(
        new ScanCommand({
          TableName: INCENTIVE_TABLE,
          ExclusiveStartKey: startKey,
          ProjectionExpression: 'eventId, customer, surveyToken, #status',
          ExpressionAttributeNames: { '#status': 'status' },
        }),
      )
      .catch(() => null);
    if (!page) return adopted;

    for (const item of page.Items ?? []) {
      if ((item.status?.S ?? '') !== 'PENDING') continue;
      const eventId = item.eventId?.S ?? '';
      const token = item.surveyToken?.S ?? '';
      if (!eventId || !token) continue;

      try {
        await dynamo.send(
          new PutItemCommand({
            TableName: SURVEY_TABLE,
            Item: {
              id: { S: eventId },
              __typename: { S: 'SurveyResponse' },
              eventId: { S: eventId },
              customer: { S: item.customer?.S ?? '' },
              surveyVersion: { S: SURVEY_VERSION },
              // The same token the person already holds in their inbox.
              surveyToken: { S: token },
              requestedAt: { S: nowISO },
              createdAt: { S: nowISO },
              updatedAt: { S: nowISO },
            },
            ConditionExpression: 'attribute_not_exists(id)',
          }),
        );
        adopted += 1;
      } catch (error) {
        // Already has a row, which is the ordinary answer after the first run.
        if ((error as { name?: string }).name === 'ConditionalCheckFailedException') continue;
        console.error('Could not adopt a research invitation', {
          at: nowISO,
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);

  if (adopted > 0) {
    console.log('Adopted outstanding research invitations', { at: nowISO, adopted });
  }
  return adopted;
}

/**
 * Open this event's survey row, in the invited state, and hand back the link.
 *
 * The row is created here with its token, before anybody answers — the
 * survey-response function only ever fills a row in, never creates one. That is
 * what makes the token unforgeable: a row that appeared because somebody
 * guessed an id would be a row with no proof anyone was ever sent it.
 *
 * The conditional put is also the idempotency. One invitation per event, however
 * many times this job runs, and a retry mid-send cannot invite twice.
 *
 * Returns null when a row already exists, which is the ordinary answer on every
 * run after the first.
 */
async function openSurveyInvite(event: EventRow, nowISO: string): Promise<string | null> {
  if (!SURVEY_TABLE) return null;
  const token = randomBytes(24).toString('hex');
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: SURVEY_TABLE,
        Item: {
          id: { S: event.id },
          __typename: { S: 'SurveyResponse' },
          eventId: { S: event.id },
          customer: { S: event.owner },
          eventName: { S: event.name },
          surveyVersion: { S: SURVEY_VERSION },
          surveyToken: { S: token },
          requestedAt: { S: nowISO },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
          // Pre-filled from the event so question one arrives answered. The
          // host can change it; this is a starting point, not a claim.
          ...(event.eventType ? { eventType: { S: event.eventType } } : {}),
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    console.error('Could not open a survey invitation', {
      at: nowISO,
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return encodeSurveyLink({ eventId: event.id, surveyId: SURVEY_ID, token });
}

/**
 * Every survey row that has been invited, so the job can decide who is owed a
 * reminder and which events must not be asked for a rating as well.
 *
 * A scan of a table with one row per invited event — far smaller than the event
 * table this job already scans nightly.
 */
async function surveyRows(): Promise<
  Map<string, { requestedAt: string | null; reminderSentAt: string | null; completedAt: string | null; token: string }>
> {
  const rows = new Map<
    string,
    { requestedAt: string | null; reminderSentAt: string | null; completedAt: string | null; token: string }
  >();
  if (!SURVEY_TABLE) return rows;
  let startKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: SURVEY_TABLE,
        ExclusiveStartKey: startKey,
        ProjectionExpression: '#id, requestedAt, reminderSentAt, completedAt, surveyToken',
        ExpressionAttributeNames: { '#id': 'id' },
      }),
    );
    for (const item of page.Items ?? []) {
      const id = item.id?.S ?? '';
      if (!id) continue;
      rows.set(id, {
        requestedAt: item.requestedAt?.S ?? null,
        reminderSentAt: item.reminderSentAt?.S ?? null,
        completedAt: item.completedAt?.S ?? null,
        token: item.surveyToken?.S ?? '',
      });
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return rows;
}

/**
 * Claim the one reminder this survey is allowed.
 *
 * The conditional update is the "only one" rule, not the caller remembering:
 * two runs overlapping, or a retry after a timeout, both try and only one
 * writes. Returns false when somebody already claimed it.
 */
async function claimSurveyReminder(eventId: string, nowISO: string): Promise<boolean> {
  if (!SURVEY_TABLE) return false;
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: SURVEY_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'SET reminderSentAt = :now, updatedAt = :now',
        ConditionExpression:
          'attribute_exists(id) AND attribute_not_exists(reminderSentAt) AND attribute_not_exists(completedAt)',
        ExpressionAttributeValues: { ':now': { S: nowISO } },
      }),
    );
    return true;
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    console.error('Could not claim a survey reminder', {
      at: nowISO,
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function openRatingRequest(event: EventRow, nowISO: string): Promise<string | null> {
  if (!FEEDBACK_TABLE) return null;
  const token = randomBytes(24).toString('hex');
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: FEEDBACK_TABLE,
        Item: {
          id: { S: event.id },
          __typename: { S: 'EventFeedback' },
          eventId: { S: event.id },
          customer: { S: event.owner },
          eventName: { S: event.name },
          ratingToken: { S: token },
          requestedAt: { S: nowISO },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    console.error('Could not open a rating request', {
      at: nowISO,
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return encodeRatingLink({ eventId: event.id, token });
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
 * One pass: warn hosts whose galleries are closing, then invite finished
 * successful events to the research survey.
 *
 * Runs on a schedule AND on demand from the global admin dashboard, which is
 * the same code either way — a "test" path that ran different logic would
 * prove nothing about the real one. The scheduled invocation ignores the
 * return value; the admin one renders it.
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

  // ---------------------------------------------------------------------
  // Post-event survey invitations, and the one reminder.
  // ---------------------------------------------------------------------
  //
  // A second pass rather than more work inside the first, because the two jobs
  // answer different questions about different events and interleaving them
  // would make either one hard to reason about or switch off.
  //
  // The survey is part of the product now — pages/survey/[link].tsx — so there
  // is no external form to point at and no URL to check before starting. What
  // gates this pass instead is the table: without it there is nowhere to record
  // an invitation, and an invitation nothing recorded would be sent again every
  // night.
  // Outstanding gift-card invitations first, so a link already in somebody's
  // inbox has a row to land on before this run decides who still needs one.
  await backfillResearchInvites(nowISO);
  // Housekeeping, before the sending passes: a job that times out mailing
  // people should not also be the reason the funnel table never shrinks.
  const prunedAnalytics = await pruneAnalytics(now);
  const surveys = SURVEY_TABLE ? await surveyRows() : new Map();
  let invited = 0;
  let reminded = 0;

  if (SURVEY_TABLE) {
    for await (const event of allEvents()) {
      if (invited + reminded >= MAX_SENDS_PER_RUN) break;
      if (!event.id || !event.alertEmail) continue;

      const founding = Boolean(event.internalCohort);
      // Paid hosts, and comped ones in a research cohort. A free-tier trial is
      // neither: surveying every tyre-kicker would drown the signal from the
      // people who actually ran an event.
      if (!event.paid && !founding) continue;

      // Ordinary customers are asked only when their event worked — asking
      // someone whose event nobody came to how the product went is unkind, and
      // it is not what they bought. A research cohort is different: they agreed
      // to be asked, and an event that did not work is the most informative
      // case there is.
      if (!founding && !isSuccessfulEvent(event)) continue;

      const existing = surveys.get(event.id);

      // ---- the reminder ------------------------------------------------
      //
      // One, ever. reminderIsDue refuses a second and refuses one for a
      // completed survey; claimSurveyReminder then makes that a condition on
      // the write, so two overlapping runs cannot both send it.
      if (existing) {
        if (!reminderIsDue(existing, now)) continue;

        const preference = await preferencesFor(event.alertEmail, nowISO);
        if (!mayReceive(event.alertEmail, 'research-survey', preference)) continue;

        if (!SENDING_ENABLED) {
          console.log('[dry-run] would send the one survey reminder', {
            at: nowISO,
            eventId: event.id,
          });
          skipped += 1;
          continue;
        }

        if (!(await claimSurveyReminder(event.id, nowISO))) continue;

        const url = `${APP_URL}/survey/${encodeSurveyLink({
          eventId: event.id,
          surveyId: SURVEY_ID,
          token: existing.token,
        })}`;
        const subject = `One quick favour about ${event.name}`;
        const text = [
          `We asked a few days ago how SharePix went at ${event.name}, and we know how easy that is to miss.`,
          '',
          'If you have five minutes, we would still love to hear it — especially anything that annoyed you.',
          '',
          url,
          '',
          'SharePix LLC',
        ].join('\n');
        const html = [
          '<!doctype html><html><body style="margin:0;background:#faf9f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2421">',
          '<div style="max-width:520px;margin:0 auto;padding:32px 24px">',
          '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#0b7a52;margin:0 0 12px">SharePix</p>',
          `<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">One quick favour</h1>`,
          `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">We asked a few days ago how SharePix went at ${event.name}. If you have five minutes, we would still love to hear it — especially anything that annoyed you.</p>`,
          `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#12211c;color:#faf9f6;padding:14px 24px;text-decoration:none;font-weight:600">Give feedback</a></p>`,
          '<p style="font-size:13px;line-height:1.6;color:#1f2421;opacity:.6;margin:24px 0 0">SharePix LLC</p>',
          '</div></body></html>',
        ].join('');

        if (await send(event.alertEmail, subject, html, text)) {
          await markSent(event.alertEmail, nowISO);
          reminded += 1;
        }
        continue;
      }

      // ---- the invitation ----------------------------------------------
      //
      // Three days after the host's stated event date, or a fortnight after
      // they got the event when they gave none. Never measured from the upload
      // window, which closes sixty days after the event was created and has
      // nothing to do with when the event happened.
      if (!surveyIsDue(event, now)) continue;

      // Optional mail: this one we send because WE want something, so an
      // opt-out is absolute.
      const preference = await preferencesFor(event.alertEmail, nowISO);
      if (!mayReceive(event.alertEmail, 'research-survey', preference)) continue;

      if (!SENDING_ENABLED) {
        console.log('[dry-run] would invite to the post-event survey', {
          at: nowISO,
          eventId: event.id,
          founding,
          reward: event.researchIncentiveOffered,
          basis: event.date ? 'event date' : 'acquisition',
        });
        skipped += 1;
        continue;
      }

      // If this event offers a reward, record the obligation BEFORE the email
      // that promises it. Failing here skips the invitation and retries
      // tomorrow: a promise nothing is tracking is worse than a late ask.
      const offersReward = event.researchIncentiveOffered;
      if (offersReward && !(await openIncentiveObligation(event, nowISO))) continue;

      const link = await openSurveyInvite(event, nowISO);
      // Null means already invited, which is the common case on every run
      // after the first.
      if (!link) continue;

      const url = `${APP_URL}/survey/${link}`;
      const subject = `How did SharePix do at ${event.name}?`;
      // Said the same way in both versions of the email, and only when there is
      // an obligation recorded to back it: the reward does not depend on what
      // they say. If it did we would be paying for agreement, and the research
      // would be worthless.
      const rewardLine = offersReward
        ? `There is a $${INCENTIVE_AMOUNT_USD} Amazon gift card for completing it — whatever you tell us. Critical feedback earns exactly the same as praise; we would rather know.`
        : '';
      const text = [
        `Thank you for using SharePix for ${event.name}.`,
        '',
        'We are working hard to make SharePix the easiest way to collect the photos and videos guests capture at an event, and your experience can help us improve it.',
        '',
        'Would you take about five minutes to tell us what worked, what was confusing, and what you would change? We genuinely want the honest version — not just the good stuff.',
        ...(rewardLine ? ['', rewardLine] : []),
        '',
        url,
        '',
        'Thank you for helping us make SharePix better.',
        'SharePix LLC',
      ].join('\n');
      const html = [
        '<!doctype html><html><body style="margin:0;background:#faf9f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2421">',
        '<div style="max-width:520px;margin:0 auto;padding:32px 24px">',
        '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#0b7a52;margin:0 0 12px">SharePix</p>',
        `<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">How did SharePix do at ${event.name}?</h1>`,
        '<p style="font-size:15px;line-height:1.6;margin:0 0 16px">We are working hard to make SharePix the easiest way to collect the photos and videos guests capture at an event, and your experience can help us improve it.</p>',
        '<p style="font-size:15px;line-height:1.6;margin:0 0 16px">Would you take about five minutes to tell us what worked, what was confusing, and what you would change? We genuinely want the honest version — not just the good stuff.</p>',
        rewardLine
          ? `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">${rewardLine}</p>`
          : '',
        `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#12211c;color:#faf9f6;padding:14px 24px;text-decoration:none;font-weight:600">Give feedback</a></p>`,
        '<p style="font-size:13px;line-height:1.6;color:#1f2421;opacity:.6;margin:24px 0 0">Thank you for helping us make SharePix better.<br>SharePix LLC</p>',
        '</div></body></html>',
      ].join('');

      if (await send(event.alertEmail, subject, html, text)) {
        await markSent(event.alertEmail, nowISO);
        invited += 1;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Rating requests.
  // ---------------------------------------------------------------------
  //
  // A third pass, for the same reason the second one is separate: these are
  // different events being asked a different question, and one of them being
  // switched off must not affect the other.
  //
  // Deliberately NOT limited to successful events, unlike the survey. Asking
  // only the hosts whose events worked how the product went would leave the
  // one number that matters — how often it does not work — measured entirely
  // from events where it did. The survey is research and asking a host with an
  // empty gallery for ten minutes of it is unkind; this is one tap.
  let ratingsRequested = 0;
  for await (const event of allEvents()) {
    if (ratingsRequested >= MAX_SENDS_PER_RUN) break;
    if (!event.id || !event.paid) continue;

    // Never ask twice. The survey asks how satisfied they are and whether we
    // may quote them; a rating request arriving weeks later asks both again,
    // and two permission records that can disagree is worse than none.
    if (surveys.get(event.id)?.completedAt) continue;

    // Once the event is over and the dust has settled, so they are rating a
    // finished event rather than one still running.
    const windowEnd = event.uploadWindowEndsAt ? Date.parse(event.uploadWindowEndsAt) : NaN;
    if (!Number.isFinite(windowEnd)) continue;
    if (now.getTime() < windowEnd + RATING_DELAY_DAYS * 24 * 60 * 60 * 1000) continue;

    // Optional mail: we are asking for something, so an opt-out is absolute.
    const preference = await preferencesFor(event.alertEmail, nowISO);
    if (!mayReceive(event.alertEmail, 'growth-nudge', preference)) continue;

    if (!SENDING_ENABLED) {
      console.log('[dry-run] would ask for a rating', { at: nowISO, eventId: event.id });
      skipped += 1;
      continue;
    }

    const link = await openRatingRequest(event, nowISO);
    // Null means already asked, which is the common case on every run after
    // the first.
    if (!link) continue;

    const url = `${APP_URL}/rating/${link}`;
    const subject = `How did ${event.name} go?`;
    const text = [
      `Your SharePix event ${event.name} is wrapped up.`,
      '',
      'One tap tells us how it went. It takes a few seconds, and it is the main way we find out whether SharePix is doing its job.',
      '',
      url,
      '',
      'SharePix LLC',
    ].join('\n');
    const html = [
      '<!doctype html><html><body style="margin:0;background:#faf9f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2421">',
      '<div style="max-width:520px;margin:0 auto;padding:32px 24px">',
      '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#0b7a52;margin:0 0 12px">SharePix</p>',
      `<h1 style="font-size:24px;line-height:1.25;margin:0 0 16px">How did ${event.name} go?</h1>`,
      '<p style="font-size:15px;line-height:1.6;margin:0 0 16px">One tap. It takes a few seconds, and it is the main way we find out whether SharePix is doing its job.</p>',
      `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#12211c;color:#faf9f6;padding:14px 24px;text-decoration:none;font-weight:600">Rate your event</a></p>`,
      '<p style="font-size:13px;line-height:1.6;color:#1f2421;opacity:.6;margin:24px 0 0">SharePix LLC</p>',
      '</div></body></html>',
    ].join('');

    if (await send(event.alertEmail, subject, html, text)) {
      await markSent(event.alertEmail, nowISO);
      ratingsRequested += 1;
    }
  }

  const summary = {
    at: nowISO,
    considered,
    sent,
    lapsed,
    skipped,
    invited,
    reminded,
    ratingsRequested,
    prunedAnalytics,
    dryRun: !SENDING_ENABLED,
  };
  console.log('Daily tasks complete', summary);

  // Shaped for the admin dashboard, which is the only caller that reads it.
  // The wording says plainly whether anything left the building, because the
  // one thing an operator must not have to guess is whether they just mailed
  // real customers.
  return {
    ok: true,
    dryRun: !SENDING_ENABLED,
    summary: [
      `${considered} active event${considered === 1 ? '' : 's'} checked.`,
      SENDING_ENABLED
        ? `${sent} expiry reminder${sent === 1 ? '' : 's'} sent, ${invited} survey invitation${invited === 1 ? '' : 's'} sent, ${reminded} survey reminder${reminded === 1 ? '' : 's'} sent, ${ratingsRequested} rating request${ratingsRequested === 1 ? '' : 's'} sent.`
        : `Nothing was sent — EMAIL_SENDING_ENABLED is off. ${skipped} message${skipped === 1 ? '' : 's'} would have gone out.`,
      prunedAnalytics > 0
        ? `${prunedAnalytics} funnel event${prunedAnalytics === 1 ? '' : 's'} older than ${ANALYTICS_RETENTION_DAYS} days removed.`
        : '',
      lapsed > 0
        ? `${lapsed} reminder milestone${lapsed === 1 ? '' : 's'} had already passed and were recorded rather than sent late.`
        : '',
      SURVEY_TABLE ? '' : 'No survey table configured, so no invitations were considered.',
    ]
      .filter(Boolean)
      .join(' '),
  };
};
