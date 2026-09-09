import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { timingSafeEqual } from 'node:crypto';
import type { Schema } from '../../data/resource';
import {
  SURVEY_CONSENT_VERSION,
  SURVEY_QUESTIONS,
  SURVEY_VERSION,
  cleanAnswers,
  type SurveyAnswers,
} from './survey';
import { buildMetricsSnapshot } from './surveyMetrics';
import { decodeSurveyLink } from './surveyLink';

const dynamo = new DynamoDBClient({});
const SURVEY_TABLE = process.env.SURVEY_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

type Handler = Schema['surveyAction']['functionHandler'];

/**
 * The same answer for a malformed link, a wrong token and an unknown event.
 *
 * Anything else lets a stranger discover which event ids are real by feeding
 * the endpoint guesses.
 */
const REFUSED = 'That link is not valid. It may have expired.';

/** Said when the survey is already in. Not a refusal — they finished. */
const ALREADY_DONE = 'You have already sent this in. Thank you again.';

const ACTIONS = new Set(['open', 'save', 'submit']);

function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Every id this function is willing to write, built from the questions. */
const WRITABLE = new Set<string>();
for (const question of SURVEY_QUESTIONS) {
  WRITABLE.add(question.id);
  if ((question.options ?? []).some((option) => option.withText)) {
    WRITABLE.add(`${question.id}Other`);
  }
}

/** One cleaned answer as a DynamoDB attribute. Null when it cannot be stored. */
function toAttribute(value: SurveyAnswers[string]) {
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'string') return { S: value };
  if (Array.isArray(value)) return { L: value.map((entry) => ({ S: String(entry) })) };
  return null;
}

/** Read the answers already stored, so an interrupted survey can resume. */
function storedAnswers(row: Record<string, AttributeValue>): SurveyAnswers {
  const answers: SurveyAnswers = {};
  for (const id of WRITABLE) {
    const cell = row[id];
    if (!cell) continue;
    if (typeof cell.S === 'string') answers[id] = cell.S;
    else if (typeof cell.N === 'string') answers[id] = Number(cell.N);
    else if (Array.isArray(cell.L)) {
      answers[id] = cell.L.map((entry) => entry.S ?? '');
    }
  }
  return answers;
}

/** Parse the payload. Anything that is not a JSON object means no answers. */
function parseAnswers(json: string | null | undefined): SurveyAnswers {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as SurveyAnswers;
  } catch {
    return {};
  }
}

export const handler: Handler = async (event) => {
  const action = (event.arguments.action ?? '').toString();
  if (!ACTIONS.has(action)) throw new Error(REFUSED);

  const parts = decodeSurveyLink(event.arguments.link ?? '');
  if (!parts || !SURVEY_TABLE) throw new Error(REFUSED);

  const found = await dynamo
    .send(new GetItemCommand({ TableName: SURVEY_TABLE, Key: { id: { S: parts.eventId } } }))
    .catch(() => null);

  const row = found?.Item;
  // The token is checked before anything is read out of the row and before any
  // branch on its contents, so a wrong token cannot be told apart from an
  // absent row by what comes back or by how long it took.
  if (!row || !tokensMatch(row.surveyToken?.S ?? '', parts.token)) {
    throw new Error(REFUSED);
  }

  const now = new Date().toISOString();
  const eventName = row.eventName?.S ?? '';
  const alreadyCompleted = Boolean(row.completedAt?.S);

  // A completed survey is locked. Said plainly rather than refused, because
  // the person holding this link did nothing wrong — they finished.
  if (alreadyCompleted && action !== 'open') {
    return {
      ok: false,
      completed: true,
      message: ALREADY_DONE,
      eventName,
      surveyVersion: row.surveyVersion?.S ?? SURVEY_VERSION,
      answersJson: JSON.stringify(storedAnswers(row)),
      eventType: row.eventType?.S ?? null,
    };
  }

  // ---- open ---------------------------------------------------------------
  //
  // Stamps the first time it was opened, so an abandoned survey is visible as
  // "started and not finished" rather than indistinguishable from one nobody
  // ever looked at. if_not_exists, because that is a fact about the first
  // visit and every reload after it would otherwise overwrite it.
  if (action === 'open') {
    if (!alreadyCompleted) {
      await dynamo
        .send(
          new UpdateItemCommand({
            TableName: SURVEY_TABLE,
            Key: { id: { S: parts.eventId } },
            UpdateExpression:
              'SET startedAt = if_not_exists(startedAt, :now), updatedAt = :now',
            ExpressionAttributeValues: { ':now': { S: now } },
          }),
        )
        .catch((error) => {
          // Opening is a read as far as the host is concerned; failing to
          // record that they opened it must not stop them answering.
          console.error('Could not stamp startedAt', {
            at: now,
            eventId: parts.eventId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    // The event's own type, so question one arrives already answered when
    // SharePix knows it. Best-effort: a missing event only costs a prefill.
    let eventType = row.eventType?.S ?? null;
    if (!eventType && EVENT_TABLE) {
      const foundEvent = await dynamo
        .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: parts.eventId } } }))
        .catch(() => null);
      eventType = foundEvent?.Item?.eventType?.S ?? null;
    }

    return {
      ok: true,
      completed: alreadyCompleted,
      message: '',
      eventName,
      surveyVersion: SURVEY_VERSION,
      answersJson: JSON.stringify(storedAnswers(row)),
      eventType,
    };
  }

  // ---- save and submit ----------------------------------------------------
  //
  // Both write the same answers through the same validation. They differ only
  // in whether the row is closed afterwards, which is why they are one path:
  // an autosave that validated differently from a submission would be a way to
  // store an answer the submission would have refused.
  const { answers, rejected } = cleanAnswers(parseAnswers(event.arguments.answersJson));
  if (rejected.length) {
    // Never shown to the host — a legitimate browser cannot produce these.
    console.warn('Dropped unknown or invalid survey answers', {
      at: now,
      eventId: parts.eventId,
      rejected,
    });
  }

  const sets: string[] = ['updatedAt = :now', '#surveyVersion = :version'];
  const values: Record<string, AttributeValue> = {
    ':now': { S: now },
    ':version': { S: SURVEY_VERSION },
  };
  const names: Record<string, string> = { '#surveyVersion': 'surveyVersion' };

  let index = 0;
  for (const [id, value] of Object.entries(answers)) {
    // cleanAnswers already dropped anything unknown; this is the second fence,
    // and the one that decides which attributes may exist on the row at all.
    if (!WRITABLE.has(id)) continue;
    const attribute = toAttribute(value);
    if (!attribute) continue;
    const nameKey = `#a${index}`;
    const valueKey = `:a${index}`;
    names[nameKey] = id;
    values[valueKey] = attribute;
    sets.push(`${nameKey} = ${valueKey}`);
    index += 1;
  }

  if (action === 'submit') {
    sets.push('completedAt = :now', 'consentVersion = :consent');
    values[':consent'] = { S: SURVEY_CONSENT_VERSION };

    // Each permission is stamped with when it was given, and only when one was
    // actually given. A timestamp on an unanswered permission would read as a
    // record of somebody agreeing.
    if (typeof answers.testimonialPermission === 'string') {
      sets.push('testimonialPermissionAt = :now');
    }
    if (typeof answers.photoMarketingInterest === 'string') {
      sets.push('photoMarketingInterestAt = :now');
    }

    // The event as it stands right now, so the response can be read later
    // without the event row having to still agree with it.
    if (EVENT_TABLE) {
      const foundEvent = await dynamo
        .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: parts.eventId } } }))
        .catch(() => null);
      const item = foundEvent?.Item;
      if (item) {
        const snapshot = buildMetricsSnapshot(
          {
            id: parts.eventId,
            name: item.name?.S ?? eventName,
            tier: item.tier?.S ?? null,
            date: item.date?.S ?? null,
            eventType: item.eventType?.S ?? null,
            internalCohort: item.internalCohort?.S ?? null,
            createdAt: item.createdAt?.S ?? null,
            paidAt: item.paidAt?.S ?? null,
            paid: item.paid?.BOOL ?? null,
            photoCount: Number(item.photoCount?.N ?? '0'),
            videoCount: Number(item.videoCount?.N ?? '0'),
            contributorCount: Number(item.contributorCount?.N ?? '0'),
            guestUploadCount: Number(item.guestUploadCount?.N ?? '0'),
            guestBookCount: Number(item.guestBookCount?.N ?? '0'),
            uploadWindowCount: Number(item.uploadWindowCount?.N ?? '0'),
          },
          new Date(now),
        );
        sets.push('metricsJson = :metrics');
        values[':metrics'] = { S: JSON.stringify(snapshot) };
      }
    }
  }

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: SURVEY_TABLE,
        Key: { id: { S: parts.eventId } },
        UpdateExpression: `SET ${sets.join(', ')}`,
        // The lock, at the database rather than in a read-then-write race: a
        // second submission arriving while the first is in flight fails here
        // instead of overwriting a completed response.
        ConditionExpression: 'attribute_exists(id) AND attribute_not_exists(completedAt)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return {
        ok: false,
        completed: true,
        message: ALREADY_DONE,
        eventName,
        surveyVersion: SURVEY_VERSION,
        answersJson: JSON.stringify(storedAnswers(row)),
        eventType: row.eventType?.S ?? null,
      };
    }
    console.error('Could not write the survey response', {
      at: now,
      eventId: parts.eventId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('That could not be saved. Please try again.');
  }

  return {
    ok: true,
    completed: action === 'submit',
    message: '',
    eventName,
    surveyVersion: SURVEY_VERSION,
    answersJson: JSON.stringify(answers),
    eventType: (answers.eventType as string) ?? row.eventType?.S ?? null,
  };
};
