import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { buildPatch, mayEdit } from './settings';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

type Handler = Schema['updateEventSettings']['functionHandler'];

/**
 * Build the UpdateItem expression from the cleaned patch.
 *
 * Attribute names go through ExpressionAttributeNames rather than into the
 * expression text. They come from this module's own allow-list so none of them
 * could be hostile, but keeping the pattern means a future field added to the
 * list can't become an expression-injection question.
 */
function expressionFor(patch: { set: Record<string, string | boolean>; remove: string[] }) {
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const sets: string[] = [];

  Object.entries(patch.set).forEach(([field, value], index) => {
    const nameRef = `#s${index}`;
    const valueRef = `:s${index}`;
    names[nameRef] = field;
    values[valueRef] =
      typeof value === 'boolean' ? { BOOL: value } : ({ S: value } as AttributeValue);
    sets.push(`${nameRef} = ${valueRef}`);
  });

  const removes = patch.remove.map((field, index) => {
    const nameRef = `#r${index}`;
    names[nameRef] = field;
    return nameRef;
  });

  // updatedAt always moves, so a change is visible to anything watching the row.
  names['#updatedAt'] = 'updatedAt';
  values[':updatedAt'] = { S: new Date().toISOString() };
  sets.push('#updatedAt = :updatedAt');

  const clauses = [`SET ${sets.join(', ')}`];
  if (removes.length > 0) clauses.push(`REMOVE ${removes.join(', ')}`);

  return { UpdateExpression: clauses.join(' '), names, values };
}

export const handler: Handler = async (event) => {
  const eventId = (event.arguments?.eventId ?? '').toString();
  if (!eventId) return { success: false, message: 'That event could not be found.' };

  const found = await dynamo
    .send(new GetItemCommand({ TableName: EVENT_TABLE, Key: { id: { S: eventId } } }))
    .catch(() => null);
  // One message for "no such event" and "not yours", so this can't be used to
  // discover which event ids exist.
  const notYours = { success: false, message: 'That event could not be found.' };
  if (!found?.Item) return notYours;

  const caller = event.identity as { sub?: string; groups?: string[] | null } | undefined;
  if (!mayEdit(caller, found.Item.owner?.S ?? '')) return notYours;

  // A host asking for more room. Dispatched here rather than in its own
  // function so it inherits the ownership check above unchanged — the one
  // thing this mutation must get right is that you cannot file a request
  // against somebody else's event.
  //
  // It records the request and NOTHING else. No limit moves, no counter
  // changes, nobody is emailed. Capacity is granted by a person from the admin
  // dashboard, the same posture as a refund: the code writes down what was
  // asked for, and a human decides.
  const field = (event as { info?: { fieldName?: string } }).info?.fieldName ?? '';
  if (field === 'requestEventCapacity') {
    const nowISO = new Date().toISOString();
    if (found.Item.capacityGrantedAt?.S) {
      return { success: true, message: 'You already have extra room on this event.' };
    }
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          UpdateExpression: 'SET capacityRequestedAt = :now, updatedAt = :now',
          // Only the first request is recorded. A host tapping twice must not
          // reset the clock an admin is triaging by, and there is nothing to
          // gain from a second identical row.
          ConditionExpression: 'attribute_not_exists(capacityRequestedAt)',
          ExpressionAttributeValues: { ':now': { S: nowISO } },
        }),
      );
    } catch {
      // The conditional failed, which means a request is already on file.
      // That is the same outcome the host wanted, so it is not an error.
      return { success: true, message: 'Your request is already with us.' };
    }
    return {
      success: true,
      message: 'Thanks — we have your request and will be in touch by email.',
    };
  }

  const result = buildPatch(
    {
      name: event.arguments.name,
      date: event.arguments.date,
      city: event.arguments.city,
      state: event.arguments.state,
      moderationMode: event.arguments.moderationMode,
      alertEmail: event.arguments.alertEmail,
      videoUploadsEnabled: event.arguments.videoUploadsEnabled,
      guestDownloadsBlocked: event.arguments.guestDownloadsBlocked,
      uploadsClosed: event.arguments.uploadsClosed,
      qrDotStyle: event.arguments.qrDotStyle,
      qrColor: event.arguments.qrColor,
      qrLogo: event.arguments.qrLogo,
      galleryFontSet: event.arguments.galleryFontSet,
      galleryLayout: event.arguments.galleryLayout,
      galleryAccent: event.arguments.galleryAccent,
      reactionsEnabled: event.arguments.reactionsEnabled,
      commentsEnabled: event.arguments.commentsEnabled,
    },
    { photoCount: Number(found.Item.photoCount?.N ?? '0') },
  );
  if (!result.ok) return { success: false, message: result.reason };

  const { UpdateExpression, names, values } = expressionFor(result.patch);

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        // The row was read above; this makes sure it still exists rather than
        // resurrecting one an admin deleted in between.
        ConditionExpression: 'attribute_exists(id)',
      }),
    );
  } catch (error) {
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return notYours;
    throw error;
  }

  return { success: true, message: 'Event updated.' };
};
