import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';
import { isValidLinkKey } from './galleryGate';
import { newLinkKey } from './linkKey';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;
const LINK_TABLE = process.env.GALLERY_LINK_TABLE_NAME as string;

type Result = Schema['manageGalleryLink']['returnType'];

interface Request {
  info?: { fieldName?: string };
  fieldName?: string;
  arguments?: { eventId?: string; action?: string | null };
  identity?: { sub?: string; groups?: string[] | null } | null;
}

const NOT_FOUND: Result = { ok: false, message: 'That event could not be found.' };

async function getItem(table: string, id: string) {
  const out = await dynamo.send(new GetItemCommand({ TableName: table, Key: { id: { S: id } } }));
  return out.Item as Record<string, AttributeValue> | undefined;
}

/** Same ownership rule as update-event: "<sub>::<login>", compared on the sub. */
function mayManage(identity: Request['identity'], owner: string): boolean {
  if ((identity?.groups ?? []).includes('ADMINS')) return true;
  const sub = identity?.sub;
  if (!sub || !owner) return false;
  return owner.split('::')[0] === sub;
}

/**
 * The host reads or replaces the guest link key.
 *
 *   get     the current key, so QR codes and links can carry it. None until the
 *           host has replaced the QR code once.
 *   rotate  a new random key. Every link and QR code made with the old key stops
 *           opening the gallery, slideshow and downloads, and every download
 *           share link made before now stops too (the handlers compare the
 *           share's creation time with linkRotatedAt).
 *
 * The key is stored in GalleryLink, which guests cannot read; the Event row
 * only records that one exists (galleryLinkSet) and when it was replaced.
 */
async function manage(request: Request, now: number): Promise<Result> {
  const eventId = (request.arguments?.eventId ?? '').toString();
  const action = (request.arguments?.action ?? '').toString();
  if (!eventId) return NOT_FOUND;

  const event = await getItem(EVENT_TABLE, eventId);
  if (!event || !mayManage(request.identity, event.owner?.S ?? '')) return NOT_FOUND;

  if (action === 'get') {
    const row = await getItem(LINK_TABLE, eventId);
    const key = row?.linkKey?.S;
    return {
      ok: true,
      linkKey: isValidLinkKey(key) ? key : null,
      rotatedAt: row?.rotatedAt?.S ?? null,
    };
  }

  if (action === 'rotate') {
    const nowIso = new Date(now).toISOString();
    const key = newLinkKey();
    const item: Record<string, AttributeValue> = {
      id: { S: eventId },
      eventId: { S: eventId },
      linkKey: { S: key },
      rotatedAt: { S: nowIso },
      createdAt: { S: nowIso },
      updatedAt: { S: nowIso },
      __typename: { S: 'GalleryLink' },
    };
    // The key first, then the flag guests read: a guest can never be told a key
    // is required before one exists.
    await dynamo.send(new PutItemCommand({ TableName: LINK_TABLE, Item: item }));
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: 'SET galleryLinkSet = :set, linkRotatedAt = :at, updatedAt = :at',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':set': { BOOL: true }, ':at': { S: nowIso } },
      }),
    );
    return {
      ok: true,
      message: 'The QR code was replaced. Old QR codes and links no longer open the gallery.',
      linkKey: key,
      rotatedAt: nowIso,
    };
  }

  return { ok: false, message: 'That action is not available.' };
}

export const handler = async (event: Request): Promise<Result> => {
  const field = event.info?.fieldName ?? event.fieldName ?? '';
  try {
    if (field === 'manageGalleryLink') return await manage(event, Date.now());
  } catch (error) {
    console.error('gallery-access failed', { field, error });
    return { ok: false, message: 'Something went wrong. Please try again.' };
  }
  return { ok: false, message: 'That action is not available.' };
};
