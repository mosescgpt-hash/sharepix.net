import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  MAX_CATEGORIES,
  START_STATE,
  cleanCategoryName,
  destinationOfScan,
  isCategoryId,
  isControlPayload,
  makeControlCode,
  markerLabel,
  markerToScanId,
  parseCategories,
  readControlCode,
  stateAfterScan,
  step,
  uploadsAfterScan,
  type Destination,
  type Marker,
} from './boothControl';
import { connectionId, mayRunOwnBooth, mayUploadToEvent } from './photographerAccess';
import { boothScanKey, isBoothToken, validClockOffset } from './rules';
import {
  MAX_PHOTOS_PER_CALL,
  applyAssignment,
  isAssignAction,
  recipientsOf,
  type Recipient,
  actionNeedsTarget,
  matchAfter,
} from './recipients';

const dynamo = new DynamoDBClient({});
const s3 = new S3Client({});
const BUCKET = process.env.PHOTO_BUCKET_NAME ?? '';
/** Thumbnails on the sorting screen; long enough for one sorting session. */
const THUMB_URL_TTL_SECONDS = 60 * 60;

/** A short-lived link to a booth photo's thumbnail, for the sorting screen only. */
async function thumbUrlOf(item: Record<string, AttributeValue>): Promise<string | null> {
  const key = item.thumbnailObjectKey?.S ?? item.previewObjectKey?.S ?? '';
  // Only the private pro/ prefix this function is granted; never an original.
  if (!BUCKET || !key.startsWith('pro/') || key.includes('/originals/')) return null;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: THUMB_URL_TTL_SECONDS,
  }).catch(() => null);
}

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const CONNECTION_TABLE = process.env.CONNECTION_TABLE_NAME as string;
const ATTENDEE_TABLE = process.env.BOOTH_ATTENDEE_TABLE_NAME as string;
const SCAN_TABLE = process.env.BOOTH_SCAN_TABLE_NAME as string;
const PHOTO_TABLE = process.env.PHOTO_TABLE_NAME as string;
/** Server-only; also signs and checks start/stop codes (boothControl.ts). */
const BOOTH_PRIVATE_KEY = process.env.BOOTH_PRIVATE_KEY ?? '';

/** Explicit in the schema (amplify/data/resource.ts) so these cannot drift. */
const ATTENDEES_BY_TOKEN = 'boothAttendeesByToken';
const ATTENDEES_BY_EVENT = 'boothAttendeesByEventId';
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
  categoryId?: string | null;
  name?: string | null;
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
async function assign(eventId: string, sub: string, args: Args, host = false) {
  const action = args.action ?? '';
  if (action === 'event' || action === 'category') return assignToPart(eventId, sub, args, host);
  if (!isAssignAction(action)) return { ok: false, message: 'Unknown change.', updated: 0 };
  const ids = [...new Set((args.uploadIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: 'Choose some photos first.', updated: 0 };
  if (ids.length > MAX_PHOTOS_PER_CALL) {
    return { ok: false, message: `Choose at most ${MAX_PHOTOS_PER_CALL} photos at a time.`, updated: 0 };
  }

  let target: Recipient | null = null;
  if (actionNeedsTarget(action)) {
    target = await findAttendee(eventId, String(args.attendeeId ?? '').trim(), String(args.token ?? '').trim());
    if (!target) return { ok: false, message: 'That person is not signed up for this event.', updated: 0 };
  }

  let updated = 0;
  for (const uploadId of ids) {
    const found = await dynamo.send(
      new GetItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: uploadId } } }),
    );
    const item = found.Item;
    // A photographer changes only their own photos; the event's host (or an
    // admin) may change any booth photo on their own booth event.
    if (
      !item ||
      (!host && item.photographerId?.S !== sub) ||
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
          ? 'SET boothAttendeeIds = :ids, boothAttendeeNames = :names, boothAttendeeId = :id, boothAttendeeName = :name, boothMatch = :match, boothSegment = :person, updatedAt = :now REMOVE boothDivider'
          : action === 'divider'
            ? 'SET boothAttendeeIds = :ids, boothAttendeeNames = :names, boothMatch = :match, boothDivider = :true, updatedAt = :now REMOVE boothAttendeeId, boothAttendeeName, boothSegment, boothCategoryId, boothCategoryName'
            : 'SET boothAttendeeIds = :ids, boothAttendeeNames = :names, boothMatch = :match, boothSegment = :unsorted, updatedAt = :now REMOVE boothAttendeeId, boothAttendeeName, boothDivider, boothCategoryId, boothCategoryName',
        // Only the photographer's own photo (or, for the host, this event's
        // photo), re-checked at write time.
        ConditionExpression: host ? 'eventId = :event' : 'photographerId = :sub',
        ExpressionAttributeValues: {
          ':ids': { L: next.map((r) => ({ S: r.id })) },
          ':names': { L: next.map((r) => ({ S: r.name })) },
          ':match': { S: matchAfter(action, next.length) },
          ':now': { S: now },
          ...(host ? { ':event': { S: eventId } } : { ':sub': { S: sub } }),
          ...(action === 'divider' ? { ':true': { BOOL: true } } : {}),
          ...(first ? { ':id': { S: first.id }, ':name': { S: first.name }, ':person': { S: 'person' } } : {}),
          ...(!first && action !== 'divider' ? { ':unsorted': { S: 'unsorted' } } : {}),
        },
      }),
    );
    updated += 1;
  }
  const what =
    action === 'divider'
      ? 'marked as dividers (never sent)'
      : action === 'clear'
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

/** The event row's booth settings: categories and whether guest uploads are closed. */
async function boothSettings(eventId: string) {
  const ev = await dynamo.send(
    new GetItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      ProjectionExpression: 'id, boothCategories, boothUploadsClosed, boothUploadsClosedBy',
    }),
  );
  const by = ev.Item?.boothUploadsClosedBy?.S;
  return {
    categories: parseCategories(ev.Item?.boothCategories?.S ?? null),
    closedBy: (ev.Item?.boothUploadsClosed?.BOOL === true ? (by === 'stop' ? 'stop' : 'host') : null) as
      | 'host'
      | 'stop'
      | null,
  };
}

/**
 * The host's hand fix: put photos in the event's general photos, or a
 * category's. They then go to no person.
 */
async function assignToPart(eventId: string, sub: string, args: Args, host: boolean) {
  const ids = [...new Set((args.uploadIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, message: 'Choose some photos first.', updated: 0 };
  if (ids.length > MAX_PHOTOS_PER_CALL) {
    return { ok: false, message: `Choose at most ${MAX_PHOTOS_PER_CALL} photos at a time.`, updated: 0 };
  }
  let cat: { id: string; name: string } | null = null;
  if (args.action === 'category') {
    const { categories } = await boothSettings(eventId);
    cat = categories.find((c) => c.id === String(args.categoryId ?? '')) ?? null;
    if (!cat) return { ok: false, message: 'That category is not on this event.', updated: 0 };
  }
  let updated = 0;
  for (const uploadId of ids) {
    const found = await dynamo.send(new GetItemCommand({ TableName: PHOTO_TABLE, Key: { id: { S: uploadId } } }));
    const item = found.Item;
    if (!item || (!host && item.photographerId?.S !== sub) || item.eventId?.S !== eventId || item.boothMatch?.S === undefined) {
      continue;
    }
    await dynamo.send(
      new UpdateItemCommand({
        TableName: PHOTO_TABLE,
        Key: { id: { S: uploadId } },
        UpdateExpression: cat
          ? 'SET boothAttendeeIds = :empty, boothAttendeeNames = :empty, boothMatch = :match, boothSegment = :seg, boothCategoryId = :cid, boothCategoryName = :cname, updatedAt = :now REMOVE boothAttendeeId, boothAttendeeName, boothDivider'
          : 'SET boothAttendeeIds = :empty, boothAttendeeNames = :empty, boothMatch = :match, boothSegment = :seg, updatedAt = :now REMOVE boothAttendeeId, boothAttendeeName, boothDivider, boothCategoryId, boothCategoryName',
        ConditionExpression: host ? 'eventId = :event' : 'photographerId = :sub',
        ExpressionAttributeValues: {
          ':empty': { L: [] },
          ':match': { S: 'event' },
          ':seg': { S: cat ? 'category' : 'event' },
          ':now': { S: new Date().toISOString() },
          ...(cat ? { ':cid': { S: cat.id }, ':cname': { S: cat.name } } : {}),
          ...(host ? { ':event': { S: eventId } } : { ':sub': { S: sub } }),
        },
      }),
    );
    updated += 1;
  }
  const where = cat ? `in ${cat.name}` : 'in the event photos';
  return {
    ok: updated > 0,
    message: updated > 0 ? `${updated} photo${updated === 1 ? '' : 's'} now ${where}.` : 'None of those photos could be changed.',
    updated,
  };
}

/** A start or stop code was used: guest uploads close on stop, reopen on start (unless the host closed them). */
async function applyUploadsAfterScan(eventId: string, closedBy: 'host' | 'stop' | null, dest: Destination) {
  const before = { closed: closedBy !== null, by: closedBy };
  const after = uploadsAfterScan(before, dest);
  if (after.closed === before.closed && after.by === before.by) return;
  await setUploadsClosed(eventId, after.closed, 'stop').catch(() => undefined);
}

async function setUploadsClosed(eventId: string, closed: boolean, by: 'host' | 'stop') {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EVENT_TABLE,
      Key: { id: { S: eventId } },
      UpdateExpression: closed
        ? 'SET boothUploadsClosed = :t, boothUploadsClosedBy = :by'
        : 'SET boothUploadsClosed = :f REMOVE boothUploadsClosedBy',
      // A scanned code never undoes the host's own choice.
      ...(by === 'stop'
        ? { ConditionExpression: 'attribute_not_exists(boothUploadsClosedBy) OR boothUploadsClosedBy <> :host' }
        : {}),
      ExpressionAttributeValues: {
        ...(closed ? { ':t': { BOOL: true }, ':by': { S: by } } : { ':f': { BOOL: false } }),
        ...(by === 'stop' ? { ':host': { S: 'host' } } : {}),
      },
    }),
  );
}

/**
 * The host's "Start & stop codes" section: list the codes, add or rename a
 * category, or close / reopen guest uploads. Host (or admin) only. Codes are
 * signed here and never stored.
 */
async function boothCodes(eventId: string, args: Args) {
  const action = String(args.action ?? 'list');
  let { categories, closedBy } = await boothSettings(eventId);
  let message = '';
  if (action === 'add' || action === 'rename') {
    const name = cleanCategoryName(args.name);
    if (!name) return codesResult(eventId, categories, closedBy, false, 'Give the category a name (up to 40 characters).');
    if (action === 'add') {
      if (categories.length >= MAX_CATEGORIES) {
        return codesResult(eventId, categories, closedBy, false, `An event can have up to ${MAX_CATEGORIES} categories.`);
      }
      categories = [...categories, { id: randomBytes(6).toString('base64url'), name }];
      message = `Added ${name}.`;
    } else {
      const id = String(args.categoryId ?? '');
      if (!isCategoryId(id) || !categories.some((c) => c.id === id)) {
        return codesResult(eventId, categories, closedBy, false, 'That category is not on this event.');
      }
      categories = categories.map((c) => (c.id === id ? { id, name } : c));
      message = `Renamed to ${name}.`;
    }
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'SET boothCategories = :cats',
        ExpressionAttributeValues: { ':cats': { S: JSON.stringify(categories) } },
      }),
    );
  } else if (action === 'close' || action === 'open') {
    await setUploadsClosed(eventId, action === 'close', 'host');
    closedBy = action === 'close' ? 'host' : null;
    message = action === 'close' ? 'Guest uploads are closed.' : 'Guest uploads are open again.';
  } else if (action !== 'list') {
    return codesResult(eventId, categories, closedBy, false, 'Unknown change.');
  }
  return codesResult(eventId, categories, closedBy, true, message);
}

function codesResult(
  eventId: string,
  categories: { id: string; name: string }[],
  closedBy: 'host' | 'stop' | null,
  ok: boolean,
  message: string,
) {
  const ready = Boolean(BOOTH_PRIVATE_KEY);
  return {
    ok,
    message: ready ? message : 'Start and stop codes are not set up yet (the booth key is missing).',
    eventCode: ready ? makeControlCode(BOOTH_PRIVATE_KEY, eventId, { kind: 'e', id: '-' }) : null,
    stopCode: ready ? makeControlCode(BOOTH_PRIVATE_KEY, eventId, { kind: 's', id: '-' }) : null,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      code: ready ? makeControlCode(BOOTH_PRIVATE_KEY, eventId, { kind: 'c', id: c.id }) : null,
    })),
    uploadsClosed: closedBy !== null,
    uploadsClosedBy: closedBy,
  };
}

type Event = {
  arguments: Args;
  identity?: unknown;
  info?: { fieldName?: string };
  fieldName?: string;
};

interface Access {
  /** The photographer's connection row, when they are on this event. */
  connection: Record<string, AttributeValue> | null;
  /** The event's host (or an admin) running their own booth: all its photos. */
  host: boolean;
}

/**
 * Who may work on this booth event: an accepted photographer (the same rule as
 * uploading, mayUploadToEvent), or the event's host or an admin
 * (mayRunOwnBooth). The event must be in booth mode either way. Every way of
 * not being allowed gives the same answer: null.
 */
async function authorize(eventId: string, sub: string, groups: string[] | null): Promise<Access | null> {
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
        ProjectionExpression: 'id, boothMode, #owner',
        ExpressionAttributeNames: { '#owner': 'owner' },
      }),
    ),
  ]);
  if (event.Item?.boothMode?.BOOL !== true) return null;
  const row = connection.Item;
  const photographer = mayUploadToEvent(
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
  const host = mayRunOwnBooth({ owner: event.Item.owner?.S ?? '', boothMode: true }, sub, groups);
  if (!photographer && !host) return null;
  return { connection: photographer ? (row ?? null) : null, host };
}

/** The latest live scan by this photographer, as a destination. */
async function latestLiveScan(eventId: string, sub: string): Promise<Destination | null> {
  const res = await dynamo.send(
    new QueryCommand({
      TableName: SCAN_TABLE,
      IndexName: SCANS_BY_KEY,
      KeyConditionExpression: 'scanKey = :key',
      ExpressionAttributeValues: { ':key': { S: boothScanKey(eventId, sub) } },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const item = res.Items?.[0];
  if (!item?.attendeeId?.S) return null;
  return destinationOfScan({
    attendeeId: item.attendeeId.S,
    name: item.attendeeName?.S ?? 'Guest',
    categoryId: item.categoryId?.S ?? null,
    categoryName: item.categoryName?.S ?? null,
  });
}

/** Record one live scan (a person, or a start/stop code) from now on. */
async function recordLiveScan(eventId: string, sub: string, marker: Marker, dest: Destination) {
  const now = new Date().toISOString();
  const cat: Record<string, AttributeValue> =
    dest.to === 'category' || (dest.to === 'person' && dest.categoryId)
      ? { categoryId: { S: dest.categoryId ?? '' }, categoryName: { S: dest.categoryName ?? '' } }
      : {};
  await dynamo.send(
    new PutItemCommand({
      TableName: SCAN_TABLE,
      Item: {
        id: { S: randomUUID() },
        __typename: { S: 'BoothScan' },
        scanKey: { S: boothScanKey(eventId, sub) },
        eventId: { S: eventId },
        photographerId: { S: sub },
        attendeeId: { S: markerToScanId(marker) ?? 'none' },
        attendeeName: { S: markerLabel(marker) },
        ...cat,
        scannedAt: { S: now },
        createdAt: { S: now },
        updatedAt: { S: now },
      },
    }),
  );
  if (dest.to === 'person') {
    await dynamo
      .send(
        new UpdateItemCommand({
          TableName: ATTENDEE_TABLE,
          Key: { id: { S: dest.attendeeId } },
          UpdateExpression: dest.categoryId
            ? 'SET boothSessionAt = :now, boothSessionCategoryId = :cid, boothSessionCategoryName = :cname'
            : 'SET boothSessionAt = :now REMOVE boothSessionCategoryId, boothSessionCategoryName',
          ConditionExpression: 'attribute_exists(id)',
          ExpressionAttributeValues: {
            ':now': { S: now },
            ...(dest.categoryId ? { ':cid': { S: dest.categoryId }, ':cname': { S: dest.categoryName ?? '' } } : {}),
          },
        }),
      )
      .catch(() => undefined);
  }
}

const DEST_MESSAGE: Record<Destination['to'], string> = {
  event: 'Event started. Photos now go to the event photos.',
  category: '',
  person: '',
  stopped: 'Stopped. Photos from now on are held and not sent.',
  nobody: '',
};

async function scan(eventId: string, sub: string, token: string) {
  const prev = await latestLiveScan(eventId, sub).catch(() => null);
  const before = prev ? stateAfterScan(prev, START_STATE) : START_STATE;
  if (isControlPayload(token)) {
    const code = readControlCode(BOOTH_PRIVATE_KEY, eventId, token);
    const settings = await boothSettings(eventId);
    let marker: Marker | null = null;
    if (code?.kind === 'e') marker = { kind: 'event' };
    else if (code?.kind === 's') marker = { kind: 'stop' };
    else if (code?.kind === 'c') {
      const cat = settings.categories.find((c) => c.id === code.id);
      if (cat) marker = { kind: 'category', categoryId: cat.id, categoryName: cat.name };
    }
    if (!marker) return { ok: false, message: 'That code is not for this event.', attendeeName: null };
    const { dest } = step(before, marker);
    await recordLiveScan(eventId, sub, marker, dest);
    await applyUploadsAfterScan(eventId, settings.closedBy, dest);
    const message = dest.to === 'category' ? `Started ${dest.categoryName}. Photos now go there.` : DEST_MESSAGE[dest.to];
    return { ok: true, message, attendeeName: markerLabel(marker) };
  }
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
  const name = attendee.name?.S ?? 'Guest';
  const marker: Marker = { kind: 'person', attendeeId: attendee.id?.S ?? '', name };
  const { dest } = step(before, marker);
  await recordLiveScan(eventId, sub, marker, dest);
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

async function status(eventId: string, sub: string, access: Access) {
  const connection = access.connection ?? {};
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
  // The host sorts every booth photo, so they can pick anyone who signed up,
  // not only people they scanned themselves. Names only, never contact details.
  if (access.host) {
    let next: Record<string, AttributeValue> | undefined;
    for (let page = 0; page < 20; page += 1) {
      const res = await dynamo.send(
        new QueryCommand({
          TableName: ATTENDEE_TABLE,
          IndexName: ATTENDEES_BY_EVENT,
          KeyConditionExpression: 'eventId = :event',
          ExpressionAttributeValues: { ':event': { S: eventId } },
          ProjectionExpression: 'id, #name',
          ExpressionAttributeNames: { '#name': 'name' },
          ExclusiveStartKey: next,
        }),
      );
      for (const item of res.Items ?? []) {
        const id = item.id?.S;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        people.push({ attendeeId: id, name: item.name?.S ?? 'Guest' });
      }
      next = res.LastEvaluatedKey;
      if (!next) break;
    }
  }

  // This photographer's matched photos, for the labels on the review grid.
  const assignments: {
    uploadId: string;
    attendeeName: string | null;
    attendeeIds: string[];
    attendeeNames: string[];
    match: string;
    thumbUrl: string | null;
    publishStatus: string | null;
    createdAt: string | null;
    segment: string | null;
    categoryId: string | null;
    categoryName: string | null;
    guestUpload: boolean;
  }[] = [];
  let start: Record<string, AttributeValue> | undefined;
  for (let page = 0; page < 20; page += 1) {
    const res = await dynamo.send(
      new QueryCommand({
        TableName: PHOTO_TABLE,
        IndexName: PHOTOS_BY_EVENT,
        KeyConditionExpression: 'eventId = :event',
        // The host sees every booth photo at the event; a photographer, theirs.
        FilterExpression: access.host
          ? 'attribute_exists(boothMatch)'
          : 'photographerId = :sub AND attribute_exists(boothMatch)',
        ExpressionAttributeValues: access.host
          ? { ':event': { S: eventId } }
          : { ':event': { S: eventId }, ':sub': { S: sub } },
        ProjectionExpression:
          'id, boothAttendeeId, boothAttendeeName, boothAttendeeIds, boothAttendeeNames, boothMatch, boothSegment, boothCategoryId, boothCategoryName, boothGuestUpload, thumbnailObjectKey, previewObjectKey, publishStatus, createdAt',
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
        thumbUrl: await thumbUrlOf(item),
        publishStatus: item.publishStatus?.S ?? null,
        createdAt: item.createdAt?.S ?? null,
        segment: item.boothSegment?.S ?? null,
        categoryId: item.boothCategoryId?.S ?? null,
        categoryName: item.boothCategoryName?.S ?? null,
        guestUpload: item.boothGuestUpload?.BOOL === true,
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
    asHost: access.host,
  };
}

export const handler = async (event: Event) => {
  const identity = event.identity as { sub?: string; groups?: string[] | null } | null | undefined;
  const sub = identity?.sub ? String(identity.sub) : '';
  const groups = identity?.groups ?? null;
  const eventId = String(event.arguments.eventId ?? '').trim();
  const field = event.info?.fieldName ?? event.fieldName ?? '';

  const access = await authorize(eventId, sub, groups);

  if (field === 'boothStatus') {
    if (!access) {
      return { booth: false, currentName: null, currentScannedAt: null, clockSynced: false, clockOffsetMs: null, assignments: [], people: [], asHost: false };
    }
    return status(eventId, sub, access);
  }

  const denied = { ok: false, message: 'That event could not be found.', attendeeName: null };

  if (field === 'assignBoothPhotos') {
    if (!access) return { ok: false, message: denied.message, updated: 0 };
    return assign(eventId, sub, event.arguments, access.host);
  }

  if (field === 'boothCodes') {
    // The host's codes and categories; never a photographer's.
    if (!access?.host) return { ok: false, message: denied.message, eventCode: null, stopCode: null, categories: [], uploadsClosed: false, uploadsClosedBy: null };
    return boothCodes(eventId, event.arguments);
  }

  if (!access) return denied;

  if (field === 'boothScan') {
    return scan(eventId, sub, String(event.arguments.token ?? '').trim());
  }
  if (field === 'setBoothClock') {
    // The clock is stored on a photographer's connection row; a host shooting
    // offline uses the camera's own clock and QR dividers instead.
    if (!access.connection) return denied;
    const offsetMs = event.arguments.offsetMs;
    if (!validClockOffset(offsetMs)) {
      return { ok: false, message: 'That camera clock is too far out to use. Check the camera’s date and time.', attendeeName: null };
    }
    return setClock(eventId, sub, offsetMs, event.arguments.synced === true);
  }
  return denied;
};
