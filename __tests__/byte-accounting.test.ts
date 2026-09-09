import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * Byte accounting, and the stack boundary it has to respect.
 *
 * sanitize-upload is the S3 onUpload trigger, so it lives in the storage stack.
 * The tables it needs live in the data stack, and the data stack has always
 * needed the storage bucket. Granting it those tables made the two nested
 * stacks depend on each other, which CloudFormation refuses and synthesis does
 * not detect — four merges shipped green CI and reached nothing.
 *
 * A queue makes the dependency one-way. What these assert is that it stays that
 * way, and that the counting is safe under at-least-once delivery.
 */

const sanitize = codeOnly(readSource('amplify/functions/sanitize-upload/handler.ts'));
const consumer = codeOnly(readSource('amplify/functions/record-bytes/handler.ts'));
const backend = codeOnly(readSource('amplify/backend.ts'));

describe('the publisher stays out of the data stack', () => {
  it('touches no DynamoDB table at all', () => {
    // Not "has no grant" but "cannot have one": with no client and no table
    // name, a future edit that reaches for a table is a visible change rather
    // than a one-line addition that breaks every deploy.
    expect(sanitize).not.toContain('DynamoDBClient');
    expect(sanitize).not.toContain('MEDIA_TABLE');
    expect(sanitize).not.toContain('EVENT_TABLE');
  });

  it('publishes the size instead', () => {
    expect(sanitize).toContain('SendMessageCommand');
    expect(sanitize).toContain('QueueUrl: BYTES_QUEUE_URL');
  });

  it('is inert when no queue is configured', () => {
    // Same shape as before: accounting is never worth failing an upload over.
    expect(sanitize).toContain('if (!BYTES_QUEUE_URL) return;');
  });

  it('sends only the key and the size', () => {
    // Which counter and which event are derived by the consumer from the same
    // rules, so a message cannot assert either.
    expect(sanitize).toContain('JSON.stringify({ key, size: bytes })');
  });
});

describe('the consumer', () => {
  it('is byte-identical to lib/mediaAccounting.ts below the header', () => {
    expect(bodyOf(readSource('amplify/functions/record-bytes/mediaAccounting.ts'))).toBe(
      bodyOf(readSource('lib/mediaAccounting.ts')),
    );
  });

  it('derives the event and the counter itself', () => {
    expect(consumer).toContain('kindForKey(key)');
    expect(consumer).toContain('eventIdForKey(key)');
    expect(consumer).toContain('counterForKind(kind)');
  });

  it('writes the ledger row before moving the counter', () => {
    // The conditional put is what makes a redelivered message add nothing
    // twice. SQS is at-least-once, so a counter that double-counted on retry
    // would be worse than no counter — it would look like a number.
    const put = consumer.indexOf("ConditionExpression: 'attribute_not_exists(id)'");
    const add = consumer.indexOf('ADD ${counterForKind(kind)}');
    expect(put).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(put);
  });

  it('does not retry a message it can never count', () => {
    // A poison message redelivered forever is how a queue stops being a queue.
    expect(consumer).toContain('Discarding an uncountable byte message');
    expect(consumer).toContain('Discarding an unreadable byte message');
  });

  it('reports failures per message rather than failing the batch', () => {
    expect(consumer).toContain('batchItemFailures');
  });

  it('does not retry after the row is written and the counter is not', () => {
    // Retrying cannot fix it — the conditional put refuses second time round —
    // so it is reported and dropped. The rows are the record; the counter is a
    // cache of them.
    expect(consumer).toContain('Recorded the object but could not add its bytes to the event');
  });
});

describe('the wiring', () => {
  it('puts the queue beside the publisher, in the storage stack', () => {
    // Verified against the synthesised template: both queues land in the
    // storage stack and the consumer in the data stack.
    expect(backend).toContain('backend.storage.resources.bucket.stack');
    expect(backend).toContain('bytesQueue.grantSendMessages(sanitizeFn)');
  });

  it('gives the consumer the tables, and the publisher none', () => {
    expect(backend).toContain('mediaTable.grantReadWriteData(recordBytesFn)');
    expect(backend).toContain('eventTable.grantReadWriteData(recordBytesFn)');
    expect(backend).not.toContain('mediaTable.grantReadWriteData(sanitizeFn)');
    expect(backend).not.toContain('eventTable.grantReadWriteData(sanitizeFn)');
  });

  it('parks a message that keeps failing rather than looping on it', () => {
    expect(backend).toContain('deadLetterQueue');
    expect(backend).toContain('maxReceiveCount: 3');
  });

  it('asks for per-message failure reporting', () => {
    // Without it, one bad message sends the whole batch back.
    expect(backend).toContain('reportBatchItemFailures: true');
  });
});

describe('the stack cycle cannot come back unnoticed', () => {
  it('still runs the detector as part of validation', () => {
    const pkg = JSON.parse(readSource('package.json')) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.['validate:backend']).toContain('check-stack-cycles.mjs');
  });
});
