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
import { isSuccessfulEvent } from './successfulEvent';
import {
  INCENTIVE_AMOUNT_USD,
  INCENTIVE_TYPE,
  incentiveId,
} from './researchIncentive';
import { encodeSurveyLink } from './surveyLink';
import { encodeRatingLink } from './ratingLink';

const dynamo = new DynamoDBClient({});
const ses = new SESv2Client({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const NOTIFICATION_TABLE = process.env.NOTIFICATION_TABLE_NAME as string;
const PREFERENCE_TABLE = process.env.PREFERENCE_TABLE_NAME as string;
const INCENTIVE_TABLE = process.env.INCENTIVE_TABLE_NAME as string;
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE_NAME as string;
/**
 * Where the survey itself lives.
 *
 * Configuration, not code, because whether it is a Typeform, a Google Form or
 * a page we build later changes nothing about who gets invited or what they
 * are owed. Unset means no invitation is ever sent — the programme is simply
 * off, rather than mailing people a link to nowhere.
 */
const SURVEY_URL = process.env.RESEARCH_SURVEY_URL ?? '';
/** Which survey they were asked. A second survey is a second programme. */
const SURVEY_ID = process.env.RESEARCH_SURVEY_ID ?? 'post-event-v1';
/** Days after the upload window closes before the invitation goes out. */
const SURVEY_DELAY_DAYS = Number(process.env.RESEARCH_SURVEY_DELAY_DAYS ?? '7');
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
          '#id, #name, tier, alertEmail, uploadWindowEndsAt, paid, #owner, contributorCount, guestUploadCount',
        // `name` and `owner` are reserved in DynamoDB expressions; `id` is
        // safest aliased alongside them.
        ExpressionAttributeNames: { '#id': 'id', '#name': 'name', '#owner': 'owner' },
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
 * Create this event's research obligation, in PENDING, and hand back the link.
 *
 * PENDING means "invited, has not completed" — nothing is owed yet. The row is
 * created at invitation time rather than on completion because it carries the
 * random token the link needs, and because one row per event per survey is
 * exactly the idempotency required: a job retry cannot invite twice, and a
 * reloaded thank-you page cannot create a second gift-card obligation.
 *
 * Returns null when a row already exists, which is the ordinary "already
 * invited" answer rather than a failure.
 */
async function openResearchInvite(
  event: EventRow,
  nowISO: string,
): Promise<string | null> {
  if (!INCENTIVE_TABLE) return null;
  const token = randomBytes(24).toString('hex');
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
          surveyToken: { S: token },
          createdAt: { S: nowISO },
          updatedAt: { S: nowISO },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    console.error('Could not open a research invite', {
      at: nowISO,
      eventId: event.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return encodeSurveyLink({ eventId: event.id, surveyId: SURVEY_ID, token });
}

/**
 * Open a rating request, or null if this event already has one.
 *
 * The row is created here, with its token, BEFORE anybody rates — the submit
 * function only ever fills a row in, never creates one. That is what makes the
 * token unforgeable: a row that appeared because somebody guessed an id would
 * be a row with no proof anyone was ever sent it.
 *
 * The conditional put is also the idempotency: one request per event, however
 * many times this job runs.
 */
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
  // Research survey invitations.
  // ---------------------------------------------------------------------
  //
  // A second pass rather than more work inside the first, because the two jobs
  // answer different questions about different events and interleaving them
  // would make either one hard to reason about or switch off.
  //
  // The whole pass is skipped when there is no survey to point at. That is the
  // programme being off, not an error: mailing people a link to nowhere is
  // worse than not mailing them.
  let invited = 0;
  if (SURVEY_URL) {
    for await (const event of allEvents()) {
      if (invited >= MAX_SENDS_PER_RUN) break;
      if (!event.id || !event.paid) continue;

      // Only events that actually worked. Asking someone whose event nobody
      // came to how the product went is both useless as research and unkind.
      if (!isSuccessfulEvent(event)) continue;

      // Only after uploads have closed and the dust has settled, so they are
      // answering about a finished event rather than one still running.
      const windowEnd = event.uploadWindowEndsAt
        ? Date.parse(event.uploadWindowEndsAt)
        : NaN;
      if (!Number.isFinite(windowEnd)) continue;
      const inviteAt = windowEnd + SURVEY_DELAY_DAYS * 24 * 60 * 60 * 1000;
      if (now.getTime() < inviteAt) continue;

      // Optional mail: this one we send because WE want something, so an
      // opt-out is absolute. Nothing about the gift card changes that.
      const preference = await preferencesFor(event.alertEmail, nowISO);
      if (!mayReceive(event.alertEmail, 'research-survey', preference)) continue;

      if (!SENDING_ENABLED) {
        console.log('[dry-run] would invite to research survey', {
          at: nowISO,
          eventId: event.id,
          contributors: event.contributorCount,
          guestUploads: event.guestUploadCount,
        });
        skipped += 1;
        continue;
      }

      const link = await openResearchInvite(event, nowISO);
      // Null means already invited, which is the common case on every run
      // after the first.
      if (!link) continue;

      const url = `${APP_URL}/survey/${link}`;
      const subject = `A few questions about ${event.name}?`;
      const text = [
        `Your SharePix event ${event.name} is wrapped up, and we would like to know how it went.`,
        '',
        `It takes about ten minutes, and there is a $${INCENTIVE_AMOUNT_USD} Amazon gift card for completing it — whatever you tell us. Critical feedback earns exactly the same as praise; we would rather know.`,
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
        `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">It takes about ten minutes, and there is a $${INCENTIVE_AMOUNT_USD} Amazon gift card for completing it — whatever you tell us. Critical feedback earns exactly the same as praise; we would rather know.</p>`,
        `<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#12211c;color:#faf9f6;padding:14px 24px;text-decoration:none;font-weight:600">Start the survey</a></p>`,
        '<p style="font-size:13px;line-height:1.6;color:#1f2421;opacity:.6;margin:24px 0 0">SharePix LLC</p>',
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
    ratingsRequested,
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
        ? `${sent} expiry reminder${sent === 1 ? '' : 's'} sent, ${invited} survey invitation${invited === 1 ? '' : 's'} sent, ${ratingsRequested} rating request${ratingsRequested === 1 ? '' : 's'} sent.`
        : `Nothing was sent — EMAIL_SENDING_ENABLED is off. ${skipped} message${skipped === 1 ? '' : 's'} would have gone out.`,
      lapsed > 0
        ? `${lapsed} reminder milestone${lapsed === 1 ? '' : 's'} had already passed and were recorded rather than sent late.`
        : '',
      SURVEY_URL ? '' : 'No survey URL configured, so no invitations were considered.',
    ]
      .filter(Boolean)
      .join(' '),
  };
};
