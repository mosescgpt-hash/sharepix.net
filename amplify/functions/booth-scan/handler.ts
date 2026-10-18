import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import { connectionId, mayUploadToEvent } from './photographerAccess';
import { boothScanKey, isBoothToken, validClockOffset } from './rules';
import {
  MAX_PHOTOS_PER_CALL,
  applyAssignment,
  isAssignAction,
  recipientsOf,
  type Recipient,
} from './recipients';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME as string;
const SCAN_TABLE = process.env.BOOTH_SCAN_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;

/** Explicit in the schema (amplify/data/resource.ts) so these cannot drift. */
const ATTENDEES_BY_TOKEN = 'boothAttendeesByToken';
const SCANS_BY_KEY = 'boothScansByScanKey';
const PHOTOS_BY_EVENT = 'photosByEventId';

type Args = {
  eventId?: string | null;
  token?: string | null;
  offsetMs?: number | null;
  synced?: boolean | null;
  uploadIds?: (string | null)[] | null;
  action?: string | null;
  attendeeId?: string | null;
};

/** The recipients stored on a photo row, old single fields or step 3's lists. */
function rowRecipients(item: Record<string, AttributeValue>): Recipient[] {
  return recipientsOf({
    ids: item.boothAttendeeIds?.L?.map((v) => v.S ?? '').filter(Boolean) ?? null,
    names: item.boothAttendeeNames?.L?.map((v) => v.S ?? '') ?? null,
    id: item.boothAttendeeId?.S ?? null,
    name: item.boothAttendeeName?.S ?? null,
  });
}

/**
 * The attendee a fix-up names, by id (from the people list) or by a scanned
 * code — and only if they signed up for this event.
 */
async function findAttendee(
  eventId: string,
  attendeeId: string,
  token: string,
): Promise<Recipient | null> {
  let item: Record<string, AttributeValue> | undefined;
  if (attendeeId) {
    const found = await dynamo.send(
      new GetItemCommand({ TableName: ATTENDEE_TABLE, Key: { id: { S: attendeeId } } }),
    );
    item = found.Item;
  } else if (isBoothToken(token)) {
    const found = await dynamo.send(
      new QueryCommand({
        TableName: ATTENDEE_TABLE,
        IndexName: ATTENDEES_BY_TOKEN,
        KeyConditionExpression: '#token = :token',
        ExpressionAttributeNames: { '#token': 'token' },
        ExpressionAttributeValues: { ':token': { S: token } },
        Limit: 2,
      }),
    );
    item = found.Items?.[0];
  }
  if (!item?.id?.S || item.eventId?.S !== eventId) return null;
  return { id: item.id.S, name: item.name?.S ?? 'Guest' };
}

/**
 * Change who some of this photographer's booth photos go to. Each photo is
 * re-checked: theirs, this event's, and a booth photo. Anything else is
 * skipped rather than failing the whole batch.
 */
async function assign(eventId: string, sub: string, args: Args) {
  const action = args.action ?? '';
  if (!isAssignAction(action)) return { ok: false, message: 'Unknown change.', updated: 0 };
  const ids = [...new Set((args.uploadIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: 'Choose some photos first.', updated: 0 };
  if (ids.length > MAX_PHOTOS_PER_CALL) {
    return { ok: false, message: `Choose at most ${MAX_PHOTOS_PER_CALL} photos at a time.`, updated: 0 };
  }

  let target: Recipient | null = null;
  if (action !== 'clear') {
    target = await findAttendee(eventId, String(args.attendeeId ?? '').trim(), String(args.token ?? '').trim());
    if (!target) return { ok: false, message: 'That person is not signed up for this event.', updated: 0 };
  }

  let updated = 0;
  for (const uploadId of ids) {
    const found = await dynamo.send(
      new GetItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: uploadId } } }),
    );
    const item = found.Item;
    if (
      !item ||
      item.photographerId?.S !== sub ||
      item.eventId?.S !== eventId ||
      item.boothMatch?.S === undefined
    ) {
      continue;
    }
    const next = applyAssignment(rowRecipients(item), action, target);
    const first = next[0];
    const now = new Date().toISOString();
    await dynamo.send(
      new UpdateItemCommand({
        TableName: PHOTO_TABLE,
        Key: { id: { S: uploadId } },
        UpdateExpression: first
          ? 'SET boothAttendeeIds = :ids, boothAttendeeNames = :names, boothAttendeeId = :id, boothAttendeeName = :name, boothMatch = :match, updatedAt = :now'
          : 'SET boothAttendeeIds = :ids, boothAttendeeNames = :names, boothMatch = :match, updatedAt = :now REMOVE boothAttendeeId, boothAttendeeName',
        // Only the photographer's own photo, re-checked at write time.
        ConditionExpression: 'photographerId = :sub',
        ExpressionAttributeValues: {
          ':ids': { L: next.map((r) => ({ S: r.id })) },
          ':names': { L: next.map((r) => ({ S: r.name })) },
          ':match': { S: first ? 'manual' : 'unassigned' },
          ':now': { S: now },
          ':sub': { S: sub },
          ...(first ? { ':id': { S: first.id }, ':name': { S: first.name } } : {}),
        },
      }),
    );
    updated += 1;
  }
  const what =
    action === 'clear'
      ? 'unassigned'
      : action === 'remove'
        ? `no longer going to ${target?.name}`
        : action === 'add'
          ? `also going to ${target?.name}`
          : `now going to ${target?.name}`;
  return {
    ok: updated > 0,
    message: updated > 0 ? `${updated} photo${updated === 1 ? '' : 's'} ${what}.` : 'None of those photos could be changed.',
    updated,
  };
}

type Event = {
  arguments: Args;
  identity?: unknown;
  info?: { fieldName?: string };
  fieldName?: string;
};

/**
 * The photographer's connection row, when they may work on this booth event.
 *
 * Same rule as uploading (mayUploadToEvent), plus the event must be a booth.
 * Every way of not being allowed gives the same answer.
 */
async function authorize(
  eventId: string,
  sub: string,
): Promise<Record<string, AttributeValue> | null> {
  if (!eventId || !sub) return null;
  const [connection, event] = await Promise.all([
    dynamo.send(
      new GetItemCommand({
        TableName: CONNECTION_TABLE,
        Key: { id: { S: connectionId(eventId, sub) } },
      }),
    ),
    dynamo.send(
      new GetItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        ProjectionExpression: 'id, boothMode',
      }),
    ),
  ]);
  const row = connection.Item;
  const allowed = mayUploadToEvent(
    row
      ? {
          eventId: row.eventId?.S ?? null,
          photographerId: row.photographerId?.S ?? null,
          status: row.status?.S ?? null,
        }
      : null,
    eventId,
    sub,
  );
  if (!allowed || event.Item?.boothMode?.BOOL !== true) return null;
  return row ?? null;
}

async function scan(eventId: string, sub: string, token: string) {
  if (!isBoothToken(token)) return { ok: false, message: 'That is not a SharePix booth code.', attendeeName: null };
  const found = await dynamo.send(
    new QueryCommand({
      TableName: ATTENDEE_TABLE,
      IndexName: ATTENDEES_BY_TOKEN,
      KeyConditionExpression: '#token = :token',
      ExpressionAttributeNames: { '#token': 'token' },
      ExpressionAttributeValues: { ':token': { S: token } },
      Limit: 2,
    }),
  );
  const attendee = found.Items?.[0];
  // A code from a different event is refused rather than quietly attached.
  if (!attendee || attendee.eventId?.S !== eventId) {
    return { ok: false, message: 'That code is not for this event.', attendeeName: null };
  }
  const now = new Date().toISOString();
  const name = attendee.name?.S ?? 'Guest';
  await dynamo.send(
    new PutItemCommand({
      TableName: SCAN_TABLE,
      Item: {
        id: { S: randomUUID() },
        __typename: { S: 'BoothScan' },
        scanKey: { S: boothScanKey(eventId, sub) },
        eventId: { S: eventId },
        photographerId: { S: sub },
        attendeeId: { S: attendee.id?.S ?? '' },
        attendeeName: { S: name },
        scannedAt: { S: now },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
    }),
  );
  return { ok: true, message: `Now shooting ${name}.`, attendeeName: name };
}

async function setClock(eventId: string, sub: string, offsetMs: number, synced: boolean) {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: CONNECTION_TABLE,
        Key: { id: { S: connectionId(eventId, sub) } },
        UpdateExpression: 'SET boothClockOffsetMs = :offset, boothClockSynced = :synced, updatedAt = :now',
        // A guessed offset never replaces one the photographer measured.
        ...(synced
          ? {}
          : {
              ConditionExpression:
                'attribute_not_exists(boothClockSynced) OR boothClockSynced = :false',
            }),
        ExpressionAttributeValues: {
          ':offset': { N: String(offsetMs) },
          ':synced': { BOOL: synced },
          ':now': { S: new Date().toISOString() },
          ...(synced ? {} : { ':false': { BOOL: false } }),
        },
      }),
    );
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      return { ok: true, message: 'Your synced camera clock is kept.', attendeeName: null };
    }
    throw err;
  }
  return {
    ok: true,
    message: synced ? 'Camera clock synced.' : 'Using this phone’s time zone for the camera.',
    attendeeName: null,
  };
}

async function status(eventId: string, sub: string, connection: Record<string, AttributeValue>) {
  const latest = await dynamo.send(
    new QueryCommand({
      TableName: SCAN_TABLE,
      IndexName: SCANS_BY_KEY,
      KeyConditionExpression: 'scanKey = :key',
      ExpressionAttributeValues: { ':key': { S: boothScanKey(eventId, sub) } },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const current = latest.Items?.[0];

  // The people this photographer has scanned, newest first, for "move to".
  const people: { attendeeId: string; name: string }[] = [];
  const seen = new Set<string>();
  const recent = await dynamo.send(
    new QueryCommand({
      TableName: SCAN_TABLE,
      IndexName: SCANS_BY_KEY,
      KeyConditionExpression: 'scanKey = :key',
      ExpressionAttributeValues: { ':key': { S: boothScanKey(eventId, sub) } },
      ScanIndexForward: false,
      Limit: 500,
    }),
  );
  for (const item of recent.Items ?? []) {
    const id = item.attendeeId?.S;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    people.push({ attendeeId: id, name: item.attendeeName?.S ?? 'Guest' });
  }

  // This photographer's matched photos, for the labels on the review grid.
  const assignments: {
    uploadId: string;
    attendeeName: string | null;
    attendeeIds: string[];
    attendeeNames: string[];
    match: string;
  }[] = [];
  let start: Record<string, AttributeValue> | undefined;
  for (let page = 0; page < 20; page += 1) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: PHOTO_TABLE,
        IndexName: PHOTOS_BY_EVENT,
        KeyConditionExpression: 'eventId = :event',
        FilterExpression: 'photographerId = :sub AND attribute_exists(boothMatch)',
        ExpressionAttributeValues: { ':event': { S: eventId }, ':sub': { S: sub } },
        ProjectionExpression:
          'id, boothAttendeeId, boothAttendeeName, boothAttendeeIds, boothAttendeeNames, boothMatch',
        ExclusiveStartKey: start,
      }),
    );
    for (const item of res.Items ?? []) {
      const recipients = rowRecipients(item);
      assignments.push({
        uploadId: item.id?.S ?? '',
        attendeeName: recipients[0]?.name ?? null,
        attendeeIds: recipients.map((r) => r.id),
        attendeeNames: recipients.map((r) => r.name),
        match: item.boothMatch?.S ?? 'unassigned',
      });
    }
    start = res.LastEvaluatedKey;
    if (!start) break;
  }

  return {
    booth: true,
    currentName: current?.attendeeName?.S ?? null,
    currentScannedAt: current?.scannedAt?.S ?? null,
    clockSynced: connection.boothClockSynced?.BOOL === true,
    clockOffsetMs: connection.boothClockOffsetMs?.N ? Number(connection.boothClockOffsetMs.N) : null,
    assignments,
    people,
  };
}

export const handler = async (event: Event) => {
  const identity = event.identity as { sub?: string } | null | undefined;
  const sub = identity?.sub ? String(identity.sub) : '';
  const eventId = String(event.arguments.eventId ?? '').trim();
  const field = event.info?.fieldName ?? event.fieldName ?? '';

  const connection = await authorize(eventId, sub);

  if (field === 'boothStatus') {
    if (!connection) {
      return { booth: false, currentName: null, currentScannedAt: null, clockSynced: false, clockOffsetMs: null, assignments: [], people: [] };
    }
    return status(eventId, sub, connection);
  }

  const denied = { ok: false, message: 'That event could not be found.', attendeeName: null };

  if (field === 'assignBoothPhotos') {
    if (!connection) return { ok: false, message: denied.message, updated: 0 };
    return assign(eventId, sub, event.arguments);
  }

  if (!connection) return denied;

  if (field === 'boothScan') {
    return scan(eventId, sub, String(event.arguments.token ?? '').trim());
  }
  if (field === 'setBoothClock') {
    const offsetMs = event.arguments.offsetMs;
    if (!validClockOffset(offsetMs)) {
      return { ok: false, message: 'That camera clock is too far out to use. Check the camera’s date and time.', attendeeName: null };
    }
    return setClock(eventId, sub, offsetMs, event.arguments.synced === true);
  }
  return denied;
};
