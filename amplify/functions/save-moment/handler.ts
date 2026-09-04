// @ts-nocheck -- @aws-sdk/* is provided by the Lambda runtime, not installed as a
// dependency, so it's excluded from the backend type-check.
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'node:crypto';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { MAX_MOMENTS_PER_EVENT, validateMoment } from './moment';

const dynamo = new DynamoDBClient({});

const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const MOMENT_TABLE = process.env.MOMENT_TABLE_NAME as string;

type Handler = Schema['saveMoment']['functionHandler'];

/**
 * Whether this caller may write to this event.
 *
 * Deliberately the same shape as `mayEdit` in update-event/settings.ts. The
 * owner field Amplify writes is `<sub>::<username>`, so only the part before
 * the separator is the identity.
 */
function mayEdit(
  caller: { sub?: string | null; groups?: string[] | null } | null | undefined,
  owner: string,
): boolean {
  if ((caller?.groups ?? [])?.includes('ADMINS')) return true;
  const sub = caller?.sub;
  if (!sub || !owner) return false;
  return owner.split('::')[0] === sub;
}

export const handler: Handler = async (event) => {
  const eventId = (event.arguments?.eventId ?? '').toString().trim();
  // One answer for "no such event" and "not yours", so this cannot be used to
  // discover which event ids exist.
  const notYours = new Error('That event could not be found.');
  if (!eventId) throw notYours;

  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  if (!found?.Item) throw notYours;

  const owner = found.Item.owner?.S ?? '';
  const caller = event.identity as { sub?: string; groups?: string[] | null } | undefined;
  if (!mayEdit(caller, owner)) throw notYours;

  const checked = validateMoment({
    name: event.arguments?.name,
    description: event.arguments?.description,
    sortOrder: event.arguments?.sortOrder,
  });
  if (!checked.ok) throw new Error(checked.reason);
  const { name, description, sortOrder } = checked.moment;

  const now = new Date().toISOString();
  const momentId = (event.arguments?.momentId ?? '').toString().trim();

  // ---------------------------------------------------------------------
  // Rename an existing moment.
  // ---------------------------------------------------------------------
  if (momentId) {
    const existing = await dynamo
      .send(
        new GetItemCommand({
          TableName: MOMENT_TABLE,
          Key: { id: { S: momentId } },
          ProjectionExpression: 'id, eventId, createdAt',
        }),
      )
      .catch(() => null);

    // The moment must belong to the event whose ownership we just proved.
    // Without this check a host could rename any moment on the platform by
    // pairing their own event id with someone else's moment id.
    if (!existing?.Item || existing.Item.eventId?.S !== eventId) throw notYours;

    const names: Record<string, string> = {
      '#name': 'name',
      '#sortOrder': 'sortOrder',
      '#updatedAt': 'updatedAt',
    };
    const values: Record<string, AttributeValue> = {
      ':name': { S: name },
      ':sortOrder': { N: String(sortOrder) },
      ':updatedAt': { S: now },
    };
    const sets = ['#name = :name', '#sortOrder = :sortOrder', '#updatedAt = :updatedAt'];
    const removes: string[] = [];

    // An emptied description is cleared rather than stored as "", so the field
    // is either absent or meaningful.
    if (description) {
      names['#description'] = 'description';
      values[':description'] = { S: description };
      sets.push('#description = :description');
    } else {
      names['#description'] = 'description';
      removes.push('#description');
    }

    const clauses = [`SET ${sets.join(', ')}`];
    if (removes.length > 0) clauses.push(`REMOVE ${removes.join(', ')}`);

    await dynamo.send(
      new UpdateItemCommand({
        TableName: MOMENT_TABLE,
        Key: { id: { S: momentId } },
        UpdateExpression: clauses.join(' '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ...values, ':eventId': { S: eventId } },
        // Re-checks the row still exists and is still on this event, so a
        // delete landing between the read and the write cannot resurrect it.
        ConditionExpression: 'attribute_exists(id) AND eventId = :eventId',
      }),
    );

    return {
      id: momentId,
      eventId,
      name,
      description,
      sortOrder,
      createdAt: existing.Item.createdAt?.S ?? now,
    };
  }

  // ---------------------------------------------------------------------
  // Create a new one.
  // ---------------------------------------------------------------------
  //
  // Counted rather than tracked on the event row: moments are host-created,
  // rare, and deletable, so another counter to keep correct through deletes
  // costs more than it saves. The ceiling is an abuse bound and a usability
  // one — past a dozen the guest's picker stops being a choice and becomes a
  // form.
  //
  // Scan + filter, matching listEventPhotos and eventGuestBook. The by-event
  // index exists and this should use it, but no function in this codebase
  // queries a GSI yet and its generated name cannot be confirmed without a
  // deploy; guessing wrong fails at runtime, in production, on a path a host
  // hits. Same known debt as the other two, tracked in docs/redesign-audit.md.
  let existing = 0;
  let countKey: Record<string, unknown> | undefined;
  do {
    const page = await dynamo.send(
      new ScanCommand({
        TableName: MOMENT_TABLE,
        FilterExpression: '#eventId = :eventId',
        ExpressionAttributeNames: { '#eventId': 'eventId' },
        ExpressionAttributeValues: { ':eventId': { S: eventId } },
        Select: 'COUNT',
        ExclusiveStartKey: countKey,
      }),
    );
    existing += page.Count ?? 0;
    countKey = page.LastEvaluatedKey;
  } while (countKey);

  if (existing >= MAX_MOMENTS_PER_EVENT) {
    throw new Error(`An event can have up to ${MAX_MOMENTS_PER_EVENT} moments.`);
  }

  const item: Record<string, AttributeValue> = {
    id: { S: randomUUID() },
    __typename: { S: 'Moment' },
    eventId: { S: eventId },
    // Stamped from the event we just verified, never from the caller. This is
    // what lets the host read and delete their own moments through owner auth
    // without being able to touch anyone else's.
    eventOwner: { S: owner },
    name: { S: name },
    sortOrder: { N: String(sortOrder) },
    createdAt: { S: now },
    updatedAt: { S: now },
  };
  if (description) item.description = { S: description };

  await dynamo.send(
    new PutItemCommand({
      TableName: MOMENT_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );

  return { id: item.id.S, eventId, name, description, sortOrder, createdAt: now };
};
