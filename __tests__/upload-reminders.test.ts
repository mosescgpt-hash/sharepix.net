import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATCH_UP_HOURS,
  addDays,
  dueReminder,
  isValidEmail,
  isValidTimeZone,
  localDate,
  normalizeEmail,
  purgeDue,
  reminderOffer,
  reminderSchedule,
  zonedTime,
  type ReminderEvent,
} from '../lib/uploadReminders/rules';
import { BUSINESS_ADDRESS_LINES } from '../lib/businessInfo';
import {
  POSTAL_ADDRESS_LINES,
  buildReminderMessage,
  formatCloseDate,
  headerSafe,
} from '../amplify/functions/send-upload-reminders/message';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// A June wedding in Minneapolis, uploads open 60 days.
const event: ReminderEvent = {
  date: '2026-06-06',
  uploadWindowEndsAt: '2026-08-05T05:00:00.000Z',
  timeZone: 'America/Chicago',
  uploadRemindersEnabled: true,
};
const FIRST = Date.parse('2026-06-07T15:00:00Z'); // 10:00 CDT the morning after
const SECOND = Date.parse('2026-08-02T15:00:00Z'); // 10:00 CDT, 3 days before close

describe('the Lambda copies have not drifted', () => {
  it.each(['upload-reminders', 'send-upload-reminders'])('%s/rules.ts matches lib below the header', (fn) => {
    // If this fails, re-copy lib/uploadReminders/rules.ts over the function's
    // rules.ts, keeping its header.
    expect(bodyOf(read(`amplify/functions/${fn}/rules.ts`))).toBe(bodyOf(read('lib/uploadReminders/rules.ts')));
  });

  it('prints the same postal address the site publishes', () => {
    expect(POSTAL_ADDRESS_LINES).toEqual(BUSINESS_ADDRESS_LINES);
  });
});

describe('who can touch opt-in rows', () => {
  it('gives ReminderOptIn to admins only: no guest, owner or signed-in rule', () => {
    const schema = read('amplify/data/resource.ts');
    const start = schema.indexOf('  ReminderOptIn: a');
    const block = schema.slice(start, schema.indexOf('\n\n', start));
    expect(block).toContain(".authorization((allow) => [allow.group('ADMINS')])");
    expect(block).not.toMatch(/allow\.(guest|owner|ownerDefinedIn|authenticated|publicApiKey)/);
  });
});

describe('the admin trigger', () => {
  it('is admin-only, runs the scheduled function, and takes nothing but probe', () => {
    const schema = read('amplify/data/resource.ts');
    const start = schema.indexOf('  runUploadReminders: a');
    const block = schema.slice(start, schema.indexOf('\n\n', start));
    expect(block).toContain(".authorization((allow) => [allow.group('ADMINS')])");
    expect(block).toContain('.handler(a.handler.function(sendUploadRemindersFn))');
    expect(block).toContain('.arguments({ probe: a.boolean() })');
  });

  it('answers a probe before any work', () => {
    const source = read('amplify/functions/send-upload-reminders/handler.ts');
    const body = source.slice(source.indexOf('export const handler = async ('));
    expect(body.indexOf('arguments?.probe')).toBeGreaterThan(-1);
    expect(body.indexOf('arguments?.probe')).toBeLessThan(body.indexOf('await run()'));
  });
});

describe('time zones', () => {
  it('finds 10:00 local in UTC, including across DST changes', () => {
    expect(zonedTime('2026-06-07', 10, 'America/Chicago').toISOString()).toBe('2026-06-07T15:00:00.000Z');
    expect(zonedTime('2026-12-07', 10, 'America/Chicago').toISOString()).toBe('2026-12-07T16:00:00.000Z');
    expect(zonedTime('2026-11-01', 10, 'America/New_York').toISOString()).toBe('2026-11-01T15:00:00.000Z');
    expect(zonedTime('2026-03-08', 10, 'America/New_York').toISOString()).toBe('2026-03-08T14:00:00.000Z');
    expect(zonedTime('2026-06-07', 10, 'Asia/Kolkata').toISOString()).toBe('2026-06-07T04:30:00.000Z');
  });

  it('knows which calendar day an instant falls on locally', () => {
    expect(localDate(Date.parse('2026-06-07T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-06-06');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('accepts real IANA zones only', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe('reminderSchedule', () => {
  it('sends reminder 1 the morning after and reminder 2 three days before close', () => {
    const s = reminderSchedule(event, 0);
    expect(s.first?.getTime()).toBe(FIRST);
    expect(s.second?.getTime()).toBe(SECOND);
  });

  it('skips reminder 2 when the window is a week or less', () => {
    const short = { ...event, uploadWindowEndsAt: '2026-06-13T05:00:00.000Z' };
    expect(reminderSchedule(short, 0).second).toBeNull();
    const eightDays = { ...event, uploadWindowEndsAt: '2026-06-14T12:00:00.000Z' };
    expect(reminderSchedule(eightDays, 0).second).not.toBeNull();
  });

  it('has no morning-after reminder for an event with no date', () => {
    const s = reminderSchedule({ ...event, date: null }, Date.parse('2026-06-06T00:00:00Z'));
    expect(s.first).toBeNull();
    expect(s.second?.getTime()).toBe(SECOND);
  });

  it('falls back to Central time when the zone is missing', () => {
    expect(reminderSchedule({ ...event, timeZone: null }, 0).first?.getTime()).toBe(FIRST);
  });
});

describe('reminderOffer', () => {
  it('offers "tomorrow" before reminder 1, then "before close", then nothing', () => {
    expect(reminderOffer(event, FIRST - HOUR)?.kind).toBe('first');
    expect(reminderOffer(event, FIRST + HOUR)?.kind).toBe('second');
    expect(reminderOffer(event, SECOND + HOUR)).toBeNull();
  });

  it.each([
    ['the switch is off', { uploadRemindersEnabled: false }],
    ['the switch was never set', { uploadRemindersEnabled: null }],
    ['the host closed uploads', { uploadsClosed: true }],
    ['the event is unpaid', { paid: false }],
    ['an admin took it down', { takenDownAt: '2026-06-06T00:00:00Z' }],
    ['the window has passed', { uploadWindowEndsAt: '2026-06-01T00:00:00Z' }],
  ])('offers nothing when %s', (_why, patch) => {
    expect(reminderOffer({ ...event, ...patch }, FIRST - HOUR)).toBeNull();
  });
});

describe('dueReminder', () => {
  const optIn = { createdAt: '2026-06-06T23:00:00Z' };

  it('is due at 10:00 local and stays due through the catch-up window', () => {
    expect(dueReminder(event, optIn, FIRST - 1)).toBeNull();
    expect(dueReminder(event, optIn, FIRST)).toBe('first');
    expect(dueReminder(event, optIn, FIRST + CATCH_UP_HOURS * HOUR - 1)).toBe('first');
    expect(dueReminder(event, optIn, FIRST + CATCH_UP_HOURS * HOUR)).toBeNull();
  });

  it('never sends one twice', () => {
    expect(dueReminder(event, { ...optIn, firstSentAt: '2026-06-07T15:05:00Z' }, FIRST + HOUR)).toBeNull();
    expect(dueReminder(event, { ...optIn, secondSentAt: '2026-08-02T15:05:00Z' }, SECOND + HOUR)).toBeNull();
  });

  it('sends reminder 2 even to someone who got reminder 1', () => {
    expect(dueReminder(event, { ...optIn, firstSentAt: '2026-06-07T15:05:00Z' }, SECOND)).toBe('second');
  });

  it('does not send "tomorrow" to someone who opted in after it was due', () => {
    expect(dueReminder(event, { createdAt: '2026-06-07T17:00:00Z' }, FIRST + 3 * HOUR)).toBeNull();
    expect(dueReminder(event, { createdAt: '2026-06-07T17:00:00Z' }, SECOND)).toBe('second');
  });

  it('stops for an unsubscribe, a closed event or a switched-off event', () => {
    expect(dueReminder(event, { ...optIn, unsubscribed: true }, FIRST)).toBeNull();
    expect(dueReminder({ ...event, uploadsClosed: true }, optIn, FIRST)).toBeNull();
    expect(dueReminder({ ...event, uploadRemindersEnabled: false }, optIn, FIRST)).toBeNull();
  });
});

describe('purgeDue', () => {
  it('deletes 30 days after uploads close, not before', () => {
    const closes = Date.parse(event.uploadWindowEndsAt!);
    expect(purgeDue(event.uploadWindowEndsAt, closes + 30 * DAY - 1)).toBe(false);
    expect(purgeDue(event.uploadWindowEndsAt, closes + 30 * DAY)).toBe(true);
    expect(purgeDue(null, Date.now())).toBe(false);
  });
});

describe('email addresses', () => {
  it.each(['sam@example.com', 'first.last+tag@sub.example.co.uk', "o'neil@example.org"])('accepts %s', (e) => {
    expect(isValidEmail(e)).toBe(true);
  });

  it.each([
    '',
    'plainaddress',
    '@example.com',
    'sam@',
    'sam@example',
    'sam@@example.com',
    'sam@exa mple.com',
    'sam..x@example.com',
    'sam@example.c0m',
    'sam@-example.com',
    'sam@example.com\r\nBcc: x@y.com',
    `${'a'.repeat(250)}@example.com`,
  ])('rejects %j', (e) => {
    expect(isValidEmail(e)).toBe(false);
  });

  it('normalises case and whitespace', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
    expect(normalizeEmail(undefined)).toBe('');
  });
});

describe('the reminder email', () => {
  const input = {
    kind: 'first' as const,
    eventName: 'Anderson <b>Wedding</b>\r\nBcc: x@y.com',
    uploadUrl: 'https://www.sharepix.net/event/abc/upload',
    unsubscribeUrl: 'https://www.sharepix.net/reminders/stop?r=1&t=2',
    closesOn: 'Wednesday, August 5',
  };

  it('has the event name, one upload button, an unsubscribe link and the postal address', () => {
    const m = buildReminderMessage(input);
    expect(m.subject).toBe('Add your photos from Anderson <b>Wedding</b> Bcc: x@y.com');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).toContain('Anderson &lt;b&gt;Wedding&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Wedding');
    expect(m.html.match(/>Add your photos<\/a>/g)).toHaveLength(1);
    expect(m.html).toContain('href="https://www.sharepix.net/reminders/stop?r=1&amp;t=2"');
    for (const line of POSTAL_ADDRESS_LINES) {
      expect(m.html).toContain(line);
      expect(m.text).toContain(line);
    }
    expect(m.text).toContain(`Unsubscribe: ${input.unsubscribeUrl}`);
    expect(m.text).toContain(`Add your photos: ${input.uploadUrl}`);
  });

  it('words reminder 2 around the closing date', () => {
    const m = buildReminderMessage({ ...input, kind: 'second', eventName: 'Sam & Lee' });
    expect(m.subject).toBe('A few days left to add your photos from Sam & Lee');
    expect(m.text).toContain('close soon, on Wednesday, August 5');
  });

  it('formats the closing day in the event zone', () => {
    expect(formatCloseDate('2026-08-05T05:00:00.000Z', 'America/Chicago')).toBe('Wednesday, August 5');
    expect(formatCloseDate('2026-08-05T05:00:00.000Z', 'America/Los_Angeles')).toBe('Tuesday, August 4');
    expect(formatCloseDate(null, 'America/Chicago')).toBeNull();
  });

  it('strips control characters from header values', () => {
    expect(headerSafe('a\r\nb\tc')).toBe('a b c');
  });
});

// ---------------------------------------------------------------------------
// The handlers, against an in-memory DynamoDB and SES
// ---------------------------------------------------------------------------

type Item = Record<string, any>;
interface FakeDb {
  tables: Record<string, Map<string, Item>>;
  sent: Array<{ to: string[]; subject: string; headers: unknown }>;
  failSend: boolean;
}

function fakeAws(db: FakeDb) {
  const cond = (expr: string | undefined, item: Item | undefined, values: Item = {}) => {
    if (!expr) return true;
    if (expr.includes('attribute_not_exists(id)') && !expr.includes('attribute_exists(id) AND')) return !item;
    if (expr.startsWith('attribute_exists(id) AND (attribute_not_exists(reminderOptInCount)')) {
      if (!item) return false;
      const n = Number(item.reminderOptInCount?.N ?? 0);
      return n < Number(values[':max'].N);
    }
    if (expr.startsWith('attribute_exists(id) AND attribute_not_exists(#sent)')) return !!item;
    return true;
  };
  const fail = () => Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });

  class Cmd {
    constructor(public input: any) {}
  }
  class GetItemCommand extends Cmd {}
  class PutItemCommand extends Cmd {}
  class UpdateItemCommand extends Cmd {}
  class DeleteItemCommand extends Cmd {}
  class ScanCommand extends Cmd {}
  class DynamoDBClient {
    async send(cmd: Cmd) {
      const { input } = cmd as any;
      const table = (db.tables[input.TableName] ??= new Map());
      if (cmd instanceof GetItemCommand) return { Item: table.get(input.Key.id.S) };
      if (cmd instanceof PutItemCommand) {
        if (!cond(input.ConditionExpression, table.get(input.Item.id.S))) throw fail();
        table.set(input.Item.id.S, { ...input.Item });
        return {};
      }
      if (cmd instanceof DeleteItemCommand) {
        table.delete(input.Key.id.S);
        return {};
      }
      if (cmd instanceof ScanCommand) {
        const rows = [...table.values()].filter(
          (r) => !input.ExpressionAttributeValues || r.eventId?.S === input.ExpressionAttributeValues[':e'].S,
        );
        return { Items: rows };
      }
      if (cmd instanceof UpdateItemCommand) {
        const id = input.Key.id.S;
        const item = table.get(id);
        const vals = input.ExpressionAttributeValues ?? {};
        const names = input.ExpressionAttributeNames ?? {};
        if (!cond(input.ConditionExpression, item, vals)) throw fail();
        if (
          input.ConditionExpression?.includes('attribute_not_exists(#sent)') &&
          (item?.[names['#sent']] || item?.unsubscribed?.BOOL === true)
        ) {
          throw fail();
        }
        const next: Item = { ...(item ?? { id: { S: id } }) };
        const expr: string = input.UpdateExpression;
        const add = expr.match(/^ADD (\w+) (:\w+)/);
        if (add) next[add[1]] = { N: String(Number(next[add[1]]?.N ?? 0) + Number(vals[add[2]].N)) };
        const set = expr.match(/^SET (.*)$/);
        if (set) {
          for (const part of set[1].split(',')) {
            const [k, v] = part.split('=').map((x) => x.trim());
            next[names[k] ?? k] = vals[v];
          }
        }
        const remove = expr.match(/^REMOVE (.*)$/);
        if (remove) delete next[names[remove[1].trim()] ?? remove[1].trim()];
        table.set(id, next);
        return {};
      }
      throw new Error('unexpected command');
    }
  }
  class SendEmailCommand extends Cmd {}
  class SESv2Client {
    async send(cmd: any) {
      if (db.failSend) throw new Error('SES down');
      db.sent.push({
        to: cmd.input.Destination.ToAddresses,
        subject: cmd.input.Content.Simple.Subject.Data,
        headers: cmd.input.Content.Simple.Headers,
      });
      return {};
    }
  }
  jest.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
    DeleteItemCommand,
    ScanCommand,
  }));
  jest.doMock('@aws-sdk/client-sesv2', () => ({ SESv2Client, SendEmailCommand }));
}

function setup(sending: boolean) {
  jest.resetModules();
  process.env.EVENT_TABLE_NAME = 'Event';
  process.env.REMINDER_OPT_IN_TABLE_NAME = 'OptIn';
  process.env.EMAIL_SENDING_ENABLED = sending ? 'true' : '';
  const db: FakeDb = { tables: { Event: new Map(), OptIn: new Map() }, sent: [], failSend: false };
  fakeAws(db);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mutations = require('../amplify/functions/upload-reminders/handler');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sender = require('../amplify/functions/send-upload-reminders/handler');
  db.tables.Event.set('ev1', {
    id: { S: 'ev1' },
    name: { S: 'Anderson Wedding' },
    owner: { S: 'host-sub::host' },
    date: { S: event.date },
    uploadWindowEndsAt: { S: event.uploadWindowEndsAt },
    timeZone: { S: 'America/Chicago' },
    uploadRemindersEnabled: { BOOL: true },
  });
  return { db, mutations, sender };
}

const call = (handler: any, fieldName: string, args: Item, identity: Item | null = null) =>
  handler({ arguments: args, identity, info: { fieldName } });

describe('requestUploadReminder', () => {
  beforeEach(() => jest.useFakeTimers({ now: FIRST - 6 * HOUR }));
  afterEach(() => jest.useRealTimers());

  it('stores one row per address per event and counts it', async () => {
    const { db, mutations } = setup(false);
    const first = await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email: ' Sam@Example.com ' });
    expect(first).toEqual({ ok: true, message: 'Done. We’ll email you tomorrow morning.' });
    const again = await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email: 'sam@example.com' });
    expect(again.ok).toBe(true);
    expect(db.tables.OptIn.size).toBe(1);
    const row = [...db.tables.OptIn.values()][0];
    expect(row.email.S).toBe('sam@example.com');
    expect(row.unsubscribeToken.S).toMatch(/^[0-9a-f]{64}$/);
    // The duplicate gave its slot back.
    expect(db.tables.Event.get('ev1')!.reminderOptInCount.N).toBe('1');
  });

  it('refuses a bad address, an unknown event and a switched-off event', async () => {
    const { db, mutations } = setup(false);
    expect((await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email: 'nope' })).ok).toBe(false);
    expect((await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev9', email: 'a@b.co' })).ok).toBe(false);
    db.tables.Event.get('ev1')!.uploadRemindersEnabled = { BOOL: false };
    expect((await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email: 'a@b.co' })).ok).toBe(false);
    expect(db.tables.OptIn.size).toBe(0);
  });

  it('refuses once the window has closed', async () => {
    const { db, mutations } = setup(false);
    jest.setSystemTime(Date.parse(event.uploadWindowEndsAt!) + HOUR);
    expect((await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email: 'a@b.co' })).ok).toBe(false);
    expect(db.tables.OptIn.size).toBe(0);
  });

  it('stops at the per-event ceiling', async () => {
    const { db, mutations } = setup(false);
    db.tables.Event.get('ev1')!.reminderOptInCount = { N: '3000' };
    expect((await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email: 'a@b.co' })).ok).toBe(false);
  });
});

describe('stopUploadReminders and setUploadReminders', () => {
  beforeEach(() => jest.useFakeTimers({ now: FIRST - 6 * HOUR }));
  afterEach(() => jest.useRealTimers());

  it('unsubscribes with the right token only', async () => {
    const { db, mutations } = setup(false);
    await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email: 'sam@example.com' });
    const row = [...db.tables.OptIn.values()][0];
    const wrong = await call(mutations.handler, 'stopUploadReminders', { id: row.id.S, token: 'f'.repeat(64) });
    expect(wrong.ok).toBe(false);
    expect(row.unsubscribed).toBeUndefined();
    const right = await call(mutations.handler, 'stopUploadReminders', { id: row.id.S, token: row.unsubscribeToken.S });
    expect(right.ok).toBe(true);
    expect(db.tables.OptIn.get(row.id.S)!.unsubscribed.BOOL).toBe(true);
  });

  it('lets the owner or an admin change the switch, and nobody else', async () => {
    const { db, mutations } = setup(false);
    const stranger = await call(mutations.handler, 'setUploadReminders', { eventId: 'ev1', enabled: false }, { sub: 'other' });
    expect(stranger.ok).toBe(false);
    const guest = await call(mutations.handler, 'setUploadReminders', { eventId: 'ev1', enabled: false }, null);
    expect(guest.ok).toBe(false);
    const owner = await call(
      mutations.handler,
      'setUploadReminders',
      { eventId: 'ev1', enabled: true, timeZone: 'America/Denver' },
      { sub: 'host-sub' },
    );
    expect(owner.ok).toBe(true);
    expect(db.tables.Event.get('ev1')!.timeZone.S).toBe('America/Denver');
    const admin = await call(mutations.handler, 'setUploadReminders', { eventId: 'ev1', enabled: false }, { sub: 'x', groups: ['ADMINS'] });
    expect(admin.ok).toBe(true);
    expect(db.tables.Event.get('ev1')!.uploadRemindersEnabled.BOOL).toBe(false);
  });

  it('will not turn reminders on without a valid time zone', async () => {
    const { db, mutations } = setup(false);
    delete db.tables.Event.get('ev1')!.timeZone;
    const res = await call(mutations.handler, 'setUploadReminders', { eventId: 'ev1', enabled: true, timeZone: 'Mars/Base' }, { sub: 'host-sub' });
    expect(res.ok).toBe(false);
  });
});

describe('send-upload-reminders', () => {
  afterEach(() => jest.useRealTimers());

  async function optIn(mutations: any, email: string) {
    await call(mutations.handler, 'requestUploadReminder', { eventId: 'ev1', email });
  }

  it('sends reminder 1 once, with an unsubscribe header, and not again', async () => {
    jest.useFakeTimers({ now: FIRST - 6 * HOUR });
    const { db, mutations, sender } = setup(true);
    await optIn(mutations, 'sam@example.com');

    jest.setSystemTime(FIRST + 5 * 60 * 1000);
    const run1 = await sender.handler({});
    expect(run1.summary).toContain('Sent 1 reminder.');
    expect(db.sent).toHaveLength(1);
    expect(db.sent[0].to).toEqual(['sam@example.com']);
    expect(db.sent[0].subject).toBe('Add your photos from Anderson Wedding');
    expect(JSON.stringify(db.sent[0].headers)).toContain('/reminders/stop?r=');

    await sender.handler({});
    expect(db.sent).toHaveLength(1);
  });

  it('sends nothing and claims nothing in a dry run', async () => {
    jest.useFakeTimers({ now: FIRST - 6 * HOUR });
    const { db, mutations, sender } = setup(false);
    await optIn(mutations, 'sam@example.com');
    jest.setSystemTime(FIRST + HOUR);
    const run = await sender.handler({ info: { fieldName: 'runUploadReminders' }, arguments: {} });
    expect(run.dryRun).toBe(true);
    expect(run.summary).toContain('1 would have gone out');
    expect(db.sent).toHaveLength(0);
    expect([...db.tables.OptIn.values()][0].firstSentAt).toBeUndefined();
  });

  it('does not send reminder 2 after an unsubscribe', async () => {
    jest.useFakeTimers({ now: FIRST - 6 * HOUR });
    const { db, mutations, sender } = setup(true);
    await optIn(mutations, 'sam@example.com');
    const row = [...db.tables.OptIn.values()][0];
    await call(mutations.handler, 'stopUploadReminders', { id: row.id.S, token: row.unsubscribeToken.S });
    jest.setSystemTime(SECOND + HOUR);
    await sender.handler({});
    expect(db.sent).toHaveLength(0);
  });

  it('releases a claim when SES fails, so the next hour retries', async () => {
    jest.useFakeTimers({ now: FIRST - 6 * HOUR });
    const { db, mutations, sender } = setup(true);
    await optIn(mutations, 'sam@example.com');
    jest.setSystemTime(FIRST + HOUR);
    db.failSend = true;
    const failed = await sender.handler({});
    expect(failed.ok).toBe(false);
    expect([...db.tables.OptIn.values()][0].firstSentAt).toBeUndefined();
    db.failSend = false;
    jest.setSystemTime(FIRST + 2 * HOUR);
    await sender.handler({});
    expect(db.sent).toHaveLength(1);
  });

  it('deletes opt-ins 30 days after uploads close, sending or not', async () => {
    jest.useFakeTimers({ now: FIRST - 6 * HOUR });
    const { db, mutations, sender } = setup(false);
    await optIn(mutations, 'sam@example.com');
    jest.setSystemTime(Date.parse(event.uploadWindowEndsAt!) + 31 * DAY);
    const run = await sender.handler({});
    expect(run.summary).toContain('Deleted 1 expired opt-in.');
    expect(db.tables.OptIn.size).toBe(0);
  });

  it('only reports the switch on a probe', async () => {
    const { sender } = setup(false);
    const probe = await sender.handler({ info: { fieldName: 'runUploadReminders' }, arguments: { probe: true } });
    expect(probe).toEqual({ ok: true, dryRun: true, summary: 'Guest reminder sending is OFF.' });
  });
});
