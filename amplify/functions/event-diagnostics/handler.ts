import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { Schema } from '../../data/resource';

const dynamo = new DynamoDBClient({});
const LOG_TABLE = process.env.CLIENT_LOG_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

type Handler = Schema['eventDiagnostics']['functionHandler'];

/** Batches returned per call. A batch is up to 25 entries, so this is a few thousand lines. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const EVENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** The Amplify owner string is "<sub>::<loginId>". */
function ownerSub(owner: string): string {
  return owner.split('::')[0];
}

function isAdmin(groups: string[] | null | undefined): boolean {
  return (groups ?? []).includes('ADMINS');
}

function encodeToken(key: Record<string, AttributeValue> | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null;
}

function decodeToken(token: unknown): Record<string, AttributeValue> | undefined {
  if (typeof token !== 'string' || !token) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, AttributeValue>) : undefined;
  } catch {
    return undefined;
  }
}

function parseJson(value: string | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * The logs for one event, or for the caller's own account.
 *
 * `scope: "account"` reads the caller's own My Events and sign-in logs and
 * needs nothing but being signed in, since the scope key is derived from the
 * caller's identity and never from the request. `scope: "event"` needs the
 * caller to be that event's host or a global admin. Anything else gets an
 * empty answer rather than an error, so the call cannot be used to probe which
 * event ids exist.
 */
export const handler: Handler = async (event) => {
  const empty = JSON.stringify({ rows: [], nextToken: null });
  if (!LOG_TABLE || !EVENT_TABLE) return empty;

  const identity = event.identity as unknown as { sub?: string; groups?: string[] | null } | null;
  if (!identity?.sub) return empty;

  const args = event.arguments;
  let scopeKey: string;
  if (args.scope === 'account') {
    scopeKey = `acct#${identity.sub}`;
  } else {
    const eventId = (args.eventId ?? '').toString().trim();
    if (!EVENT_ID_PATTERN.test(eventId)) return empty;
    if (!isAdmin(identity.groups)) {
      const found = await dynamo.send(
        new GetItemCommand({
          TableName: EVENT_TABLE,
          Key: { id: { S: eventId } },
          ProjectionExpression: '#owner',
          ExpressionAttributeNames: { '#owner': 'owner' },
        }),
      );
      const owner = found.Item?.owner?.S ?? '';
      if (!owner || ownerSub(owner) !== identity.sub) return empty;
    }
    scopeKey = eventId;
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.round(args.limit ?? DEFAULT_LIMIT)));
  // A support code is the first eight characters of a device id. It narrows
  // the read to that device through the device index; without one, the read is
  // newest first through the time index.
  const code = (args.deviceCode ?? '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const byDevice = code.length >= 4;

  const result = await dynamo.send(
    new QueryCommand(
      byDevice
        ? {
            TableName: LOG_TABLE,
            IndexName: 'clientLogsByEventDevice',
            KeyConditionExpression: 'eventId = :scope AND begins_with(deviceKey, :code)',
            ExpressionAttributeValues: { ':scope': { S: scopeKey }, ':code': { S: code } },
            ScanIndexForward: false,
            Limit: limit,
            ExclusiveStartKey: decodeToken(args.nextToken),
          }
        : {
            TableName: LOG_TABLE,
            IndexName: 'clientLogsByEventTs',
            KeyConditionExpression: args.since ? 'eventId = :scope AND ts > :since' : 'eventId = :scope',
            ExpressionAttributeValues: {
              ':scope': { S: scopeKey },
              ...(args.since ? { ':since': { S: args.since.toString().slice(0, 40) } } : {}),
            },
            ScanIndexForward: false,
            Limit: limit,
            ExclusiveStartKey: decodeToken(args.nextToken),
          },
    ),
  );

  const rows = (result.Items ?? []).map((item) => {
    const received = item.ts?.S ?? '';
    const receivedMs = Date.parse(received);
    const entries = (parseJson(item.entriesJson?.S, []) as Array<{ t?: number }>).map((entry) => ({
      ...entry,
      // The entry's age is subtracted from when the server received it.
      at: Number.isFinite(receivedMs) ? new Date(receivedMs - (entry.t ?? 0)).toISOString() : received,
    }));
    return {
      id: item.id?.S ?? '',
      receivedAt: received,
      deviceId: item.deviceId?.S ?? '',
      sessionId: item.sessionId?.S ?? '',
      build: item.build?.S ?? '',
      device: parseJson(item.deviceJson?.S, null),
      entries,
    };
  });

  return JSON.stringify({ rows, nextToken: encodeToken(result.LastEvaluatedKey) });
};
