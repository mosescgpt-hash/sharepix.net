import { codeOnly, readSource } from './sourceGuards';

/**
 * The diagnostic log's backend, pinned where a quiet regression would matter.
 *
 * Three promises are made to people about this log: it expires, only the host
 * and support can read it, and the browser cannot choose where or when its
 * batches are stored. Each depends on a line that no behavioural test reaches,
 * because they live in infrastructure and in a Lambda that needs DynamoDB.
 */

const schema = readSource('amplify/data/resource.ts');
const backend = codeOnly(readSource('amplify/backend.ts'));
const recorder = codeOnly(readSource('amplify/functions/record-client-log/handler.ts'));
const reader = codeOnly(readSource('amplify/functions/event-diagnostics/handler.ts'));

function modelBlock(name: string): string {
  const start = schema.indexOf(`  ${name}: a`);
  expect(start).toBeGreaterThan(-1);
  // Through the end of its .authorization(...) call, which closes the model.
  const end = schema.indexOf(']),', schema.indexOf('.authorization', start)) + 3;
  return schema.slice(start, end);
}

describe('ClientLog model', () => {
  const model = modelBlock('ClientLog');

  it('is readable by administrators only, through the data API', () => {
    expect(model).toMatch(/allow\.group\('ADMINS'\)/);
    expect(model).not.toMatch(/allow\.guest|allow\.authenticated|allow\.owner|allow\.publicApiKey/);
  });

  it('has the two indexes the reader queries, under the names it uses', () => {
    expect(model).toContain("index('eventId').sortKeys(['ts']).name('clientLogsByEventTs')");
    expect(model).toContain("index('eventId').sortKeys(['deviceKey']).name('clientLogsByEventDevice')");
    expect(reader).toContain("'clientLogsByEventTs'");
    expect(reader).toContain("'clientLogsByEventDevice'");
  });

  it('keeps its expiry time as a number, which is what TTL reads', () => {
    expect(model).toMatch(/expiresAt: a\.integer\(\)/);
  });
});

describe('expiry', () => {
  it('turns on TTL for the table, on the attribute the recorder writes', () => {
    expect(backend).toContain("amplifyDynamoDbTables.ClientLog.timeToLiveAttribute = { attributeName: 'expiresAt', enabled: true }");
    expect(recorder).toMatch(/expiresAt: \{ N: String\(Math\.floor\(received\.getTime\(\) \/ 1000\) \+ LOG_RETENTION_DAYS \* 86400\) \}/);
  });

  it('does not keep point-in-time backups of the log, which would outlive the retention promised', () => {
    expect(backend).toMatch(/if \(name === 'ClientLog'\) continue;/);
  });
});

describe('recordClientLog operation', () => {
  const start = schema.indexOf('  recordClientLog: a');
  const op = schema.slice(start, schema.indexOf('\n\n', start));

  it('is callable by guests and signed-in hosts', () => {
    expect(op).toContain('allow.guest()');
    expect(op).toContain('allow.authenticated()');
  });

  it('takes the event and the batch, and nothing the caller could use to place a row', () => {
    expect(op).toMatch(/eventId: a\.string\(\)/);
    expect(op).toMatch(/batchJson: a\.string\(\)\.required\(\)/);
    expect(op).not.toMatch(/\bts:|expiresAt|deviceKey|owner/);
  });
});

describe('record-client-log handler', () => {
  it('cleans every batch with the shared validator before storing it', () => {
    expect(recorder).toContain('sanitizeBatch(event.arguments?.batchJson)');
    expect(recorder).toContain('JSON.stringify(batch.entries)');
  });

  it('stamps the time itself rather than taking the browser\'s', () => {
    expect(recorder).toMatch(/ts: \{ S: now \}/);
    expect(recorder).not.toMatch(/arguments\??\.ts|batch\.ts/);
  });

  it('stores only for an event that exists, or for the signed-in caller\'s own account', () => {
    expect(recorder).toContain('await eventExists(named)');
    expect(recorder).toContain('`acct#${identity.sub}`');
  });

  it('applies the device, caller and scope daily limits before writing', () => {
    expect(recorder).toContain('DEVICE_DAILY_ENTRIES');
    expect(recorder).toContain('CALLER_DAILY_ENTRIES');
    expect(recorder).toContain('SCOPE_DAILY_ENTRIES');
    expect(recorder.indexOf('takeQuota(id, n, limit')).toBeLessThan(recorder.indexOf('new PutItemCommand'));
  });

  it('always answers true, so a caller cannot learn which limit it hit', () => {
    // takeQuota rethrows storage faults only; the handler itself never throws.
    const body = recorder.slice(recorder.indexOf('export const handler'));
    expect(body).not.toMatch(/return false/);
    expect(body).not.toMatch(/throw /);
  });
});

describe('event-diagnostics handler', () => {
  it('refuses callers without an identity', () => {
    expect(reader).toContain('if (!identity?.sub) return empty;');
  });

  it('lets only an administrator or the event\'s owner read an event\'s logs', () => {
    expect(reader).toContain('isAdmin(identity.groups)');
    expect(reader).toContain('ownerSub(owner) !== identity.sub');
  });

  it('scopes the account log to the caller\'s own subject, never one they name', () => {
    expect(reader).toContain('`acct#${identity.sub}`');
    expect(reader).not.toMatch(/acct#\$\{args/);
  });

  it('caps what one call returns', () => {
    expect(reader).toMatch(/MAX_LIMIT/);
  });
});

describe('wiring', () => {
  it('gives the recorder write access and no index reads', () => {
    expect(backend).toContain('clientLogTable.grantWriteData(recordClientLogFn)');
    expect(backend).not.toMatch(/clientLogTable\.grantReadData\(recordClientLogFn\)/);
  });

  it('gives the reader read access, including the indexes', () => {
    expect(backend).toContain('clientLogTable.grantReadData(eventDiagnosticsFn)');
    expect(backend).toContain('indexReadStatement([clientLogTable.tableArn])');
  });
});
