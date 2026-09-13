import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

/** Mirrors EVENT_CODE_ALPHABET in create-event/newEvent.ts. */
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

type Handler = Schema['findEventByCode']['functionHandler'];

/**
 * Look up an event by the code printed on its QR sign.
 *
 * ## What this returns, and what it deliberately does not
 *
 * The event id and nothing else. A guest needs the id to reach the upload
 * page; they do not need the host's name, the plan, the photo count or the
 * dates, and an endpoint anybody can call should hand back the minimum that
 * makes it work. The upload page itself re-checks everything that matters.
 *
 * ## The honest security position
 *
 * A six-character code from a 31-character alphabet is about 887 million
 * combinations, and the code is already the access credential — the help says
 * plainly that anyone holding it can open the gallery. So this endpoint does
 * not grant anything the documented model did not already grant.
 *
 * What it does change is reachability: before this existed there was nowhere
 * to *try* a code. With many events live, an unthrottled guesser gets luckier
 * the more events there are, and at a few thousand events an enumeration
 * attack becomes hours rather than years. Two things follow from that:
 *
 *   1. Nothing here distinguishes "no such code" from "malformed code" in
 *      wording or shape, so a scanner learns nothing from the reply beyond
 *      hit or miss.
 *   2. Rate limiting belongs in front of this (AWS WAF on the AppSync
 *      endpoint). That is deployment configuration rather than code, and it
 *      is written down in DEPLOYMENT.md rather than left implied.
 */
export const handler: Handler = async (event) => {
  const raw = String(event.arguments.code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  // Shape-check before spending a query. A malformed code cannot match
  // anything, and answering it identically to a miss keeps the two
  // indistinguishable from outside.
  if (!CODE_PATTERN.test(raw)) {
    return { found: false, eventId: null };
  }

  const result = await dynamo
    .send(
      new QueryCommand({
        TableName: EVENT_TABLE,
        IndexName: 'eventsByEventCode',
        KeyConditionExpression: 'eventCode = :code',
        ExpressionAttributeValues: { ':code': { S: raw } },
        // The id is all that leaves this function.
        ProjectionExpression: 'id',
        Limit: 1,
      }),
    )
    .catch(() => null);

  const id = result?.Items?.[0]?.id?.S ?? null;
  return { found: Boolean(id), eventId: id };
};
