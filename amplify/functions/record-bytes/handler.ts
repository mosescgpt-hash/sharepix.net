import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { counterForKind, eventIdForKey, kindForKey, usableSize } from './mediaAccounting';

const dynamo = new DynamoDBClient({});
const MEDIA_TABLE = process.env.MEDIA_TABLE_NAME as string;
const EVENT_TABLE = process.env.EVENT_TABLE_NAME as string;

/**
 * One upload's worth of accounting, as sanitize-upload publishes it.
 *
 * Only the key and the size travel. Everything else — which counter it belongs
 * to, which event, whether the size is usable at all — is derived here from the
 * same rules the rest of the codebase uses, so a malformed message cannot smuggle
 * a byte count onto an event it has nothing to do with.
 */
interface ByteMessage {
  key?: unknown;
  size?: unknown;
}

interface SqsRecord {
  messageId?: string;
  body?: string;
}

/**
 * Count one stored object.
 *
 * Idempotent by construction. The MediaObject row is a conditional put keyed on
 * the object key, and the counter on the event only moves when that put
 * succeeds — so a redelivered message adds nothing twice. SQS guarantees
 * at-least-once delivery, which makes that the property this whole function
 * turns on: a counter that double-counted on every retry would be worse than no
 * counter, because it would look like a number.
 *
 * Returns false when the message could not be counted and should be retried.
 */
async function countOne(message: ByteMessage): Promise<boolean> {
  const key = typeof message.key === 'string' ? message.key : '';
  const bytes = usableSize(message.size);
  const kind = kindForKey(key);
  const eventId = eventIdForKey(key);

  // Not countable, and never will be. Returning true drops it rather than
  // retrying a message that cannot succeed — a poison message redelivered
  // forever is how a queue stops being a queue.
  if (!key || bytes === null || !kind || !eventId) {
    console.warn('Discarding an uncountable byte message', {
      at: new Date().toISOString(),
      key,
      kind,
      eventId,
    });
    return true;
  }

  const now = new Date().toISOString();

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: MEDIA_TABLE,
        Item: {
          id: { S: key },
          __typename: { S: 'MediaObject' },
          eventId: { S: eventId },
          kind: { S: kind },
          bytes: { N: String(bytes) },
          recordedAt: { S: now },
          createdAt: { S: now },
          updatedAt: { S: now },
        },
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
  } catch (error) {
    // Already counted. The common case on any redelivery, and the reason the
    // counter below is only touched when the put actually wrote.
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') return true;
    console.error('Could not record a media object', {
      at: now,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: EVENT_TABLE,
        Key: { id: { S: eventId } },
        UpdateExpression: `ADD ${counterForKind(kind)} :bytes`,
        ExpressionAttributeValues: { ':bytes': { N: String(bytes) } },
      }),
    );
    return true;
  } catch (error) {
    // The MediaObject row is written and this counter is not, so the two now
    // disagree. Retrying will not fix it — the conditional put above will
    // refuse second time round — so this is reported and dropped rather than
    // looped. The rows are the record; the counter is a cache of them, and an
    // admin reconciling from MediaObject is the repair.
    console.error('Recorded the object but could not add its bytes to the event', {
      at: now,
      key,
      eventId,
      bytes,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
}

/**
 * Drain a batch from the queue.
 *
 * Reports failures per message rather than throwing, so one bad message does
 * not send a whole batch of good ones back for redelivery. Anything named in
 * batchItemFailures is retried; everything else is done.
 */
export const handler = async (event: { Records?: SqsRecord[] }) => {
  if (!MEDIA_TABLE || !EVENT_TABLE) {
    console.error('record-bytes is not configured with its tables; nothing was counted.');
    return { batchItemFailures: (event.Records ?? []).map((r) => ({ itemIdentifier: r.messageId ?? '' })) };
  }

  const failures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records ?? []) {
    let message: ByteMessage;
    try {
      message = JSON.parse(record.body ?? '{}') as ByteMessage;
    } catch {
      // Unparseable. Retrying cannot make it parse.
      console.warn('Discarding an unreadable byte message', { messageId: record.messageId });
      continue;
    }

    const ok = await countOne(message);
    if (!ok) failures.push({ itemIdentifier: record.messageId ?? '' });
  }

  return { batchItemFailures: failures };
};
