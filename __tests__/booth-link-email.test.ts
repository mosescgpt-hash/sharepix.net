import { buildBoothMessage } from '../amplify/functions/booth-deliveries/message';
import {
  LINK_EMAIL_COOLDOWN_MS,
  MAX_LINK_EMAILS,
  checkLinkEmail,
  linkEmailRefusal,
  maskEmail,
  promptDeliveryAllowed,
} from '../amplify/functions/booth-deliveries/linkEmail';
import { codeOnly, readSource } from './sourceGuards';

const KEY = 'A'.repeat(43);
const NOW = Date.parse('2027-01-08T20:00:00.000Z');
const state = { emailsStopped: false, linkEmailedAt: null as string | null, linkEmailCount: 0 };

describe('email me my link: the rules', () => {
  it('masks an address the way the host sees it', () => {
    expect(maskEmail('jane@example.com')).toBe('j***@example.com');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('nonsense')).toBeNull();
  });

  it('needs a real address and the guest tick before saving one', () => {
    expect(checkLinkEmail({ email: ' Jane@Example.com ', consent: true })).toEqual({ ok: true, email: 'jane@example.com' });
    expect(checkLinkEmail({ email: 'nope', consent: true }).ok).toBe(false);
    expect(checkLinkEmail({ email: 'a@b.co', consent: false }).ok).toBe(false);
    expect(checkLinkEmail({ email: 'a@b.co' }).ok).toBe(false);
    expect(checkLinkEmail({ email: `${'a'.repeat(250)}@b.co`, consent: true }).ok).toBe(false);
  });

  it('never emails someone who stopped, waits 10 minutes between, and caps the total', () => {
    expect(linkEmailRefusal({ ...state, emailsStopped: true }, NOW)).toBe('stopped');
    expect(linkEmailRefusal(state, NOW)).toBeNull();
    const recent = new Date(NOW - LINK_EMAIL_COOLDOWN_MS + 1000).toISOString();
    expect(linkEmailRefusal({ ...state, linkEmailedAt: recent, linkEmailCount: 1 }, NOW)).toBe('recent');
    const old = new Date(NOW - LINK_EMAIL_COOLDOWN_MS - 1000).toISOString();
    expect(linkEmailRefusal({ ...state, linkEmailedAt: old, linkEmailCount: 1 }, NOW)).toBeNull();
    expect(linkEmailRefusal({ ...state, linkEmailedAt: old, linkEmailCount: MAX_LINK_EMAILS }, NOW)).toBe('limit');
  });

  it('sends "ready" at once but spaces "more" by 10 minutes', () => {
    expect(promptDeliveryAllowed('ready', new Date(NOW - 1000).toISOString(), NOW)).toBe(true);
    expect(promptDeliveryAllowed('more', null, NOW)).toBe(true);
    expect(promptDeliveryAllowed('more', new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
    expect(promptDeliveryAllowed('more', new Date(NOW - 11 * 60_000).toISOString(), NOW)).toBe(true);
  });

  it('words the email so photos appear after host approval, with the stop link', () => {
    const m = buildBoothMessage({
      kind: 'session',
      attendeeName: 'Jane Doe',
      eventName: 'Gala',
      galleryUrl: 'https://www.sharepix.net/booth/photos/K',
      stopUrl: 'https://www.sharepix.net/booth/photos/K?stop=1',
      photoCount: 0,
      removedOn: null,
    });
    expect(m.subject).toBe('Your SharePix photo link for Gala');
    expect(m.text).toMatch(/after the event host approves them/);
    expect(m.text).toContain('https://www.sharepix.net/booth/photos/K');
    expect(m.text).toContain('?stop=1');
    expect(m.html).toContain('Open my photo page');
  });
});

/* ---- The handler, against a fake DynamoDB and SES. ---- */

type Item = Record<string, { S?: string; N?: string; BOOL?: boolean; L?: { S: string }[] }>;
interface World {
  attendee: Item;
  event: Item;
  photos: Item[];
  /** Make the next conditional UpdateItem on this attribute fail, as if lost to a racer. */
  failClaim: string | null;
  updates: { expr: string; names: string[] }[];
  sent: { to: string; subject: string }[];
  sesFails: boolean;
}

function baseAttendee(extra: Item = {}): Item {
  return {
    id: { S: 'att1' },
    eventId: { S: 'ev1' },
    name: { S: 'Jane Doe' },
    email: { S: 'jane@example.com' },
    galleryKey: { S: KEY },
    ...extra,
  };
}

function load(world: World) {
  // Never real credentials: if a mock missed, the call fails instead of reaching AWS.
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_PROFILE;
  process.env.AWS_REGION = 'us-east-1';
  process.env.EMAIL_SENDING_ENABLED = 'true';
  process.env.EVENT_TABLE_NAME = 'Event';
  process.env.BOOTH_ATTENDEE_TABLE_NAME = 'Attendee';
  process.env.PHOTO_TABLE_NAME = 'Photo';
  jest.restoreAllMocks();
  let mod: typeof import('../amplify/functions/booth-deliveries/handler');
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { SESv2Client } = require('@aws-sdk/client-sesv2');
    /* eslint-enable @typescript-eslint/no-require-imports */
    jest.spyOn(DynamoDBClient.prototype, 'send').mockImplementation((async (cmd: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }) => {
      const name = cmd.constructor.name;
      const input = cmd.input as { TableName?: string; IndexName?: string; UpdateExpression?: string; ConditionExpression?: string };
      if (name === 'QueryCommand') {
        if (input.IndexName === 'boothAttendeesByGalleryKey') return { Items: [world.attendee] };
        if (input.IndexName === 'photosByEventId') return { Items: world.photos };
      }
      if (name === 'GetItemCommand') return { Item: input.TableName === 'Event' ? world.event : world.attendee };
      if (name === 'UpdateItemCommand') {
        const expr = input.UpdateExpression ?? '';
        world.updates.push({ expr, names: [] });
        if (world.failClaim && input.ConditionExpression?.includes(world.failClaim)) {
          throw Object.assign(new Error('lost'), { name: 'ConditionalCheckFailedException' });
        }
        const values = (cmd.input as { ExpressionAttributeValues?: Item }).ExpressionAttributeValues ?? {};
        if (expr.startsWith('SET email =')) world.attendee.email = values[':email'];
        return {};
      }
      return {};
    }) as never);
    jest.spyOn(SESv2Client.prototype, 'send').mockImplementation((async (cmd: {
      input: { Destination: { ToAddresses: string[] }; Content: { Simple: { Subject: { Data: string } } } };
    }) => {
      if (world.sesFails) throw new Error('ses down');
      world.sent.push({ to: cmd.input.Destination.ToAddresses[0], subject: cmd.input.Content.Simple.Subject.Data });
      return {};
    }) as never);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../amplify/functions/booth-deliveries/handler');
  });
  return mod!.handler as unknown as (e: unknown) => Promise<Record<string, unknown>>;
}

function freshWorld(overrides: Partial<World> = {}): World {
  return {
    attendee: baseAttendee(),
    event: { id: { S: 'ev1' }, name: { S: 'Gala' }, owner: { S: 'o' }, boothMode: { BOOL: true }, date: { S: '2999-01-01' } },
    photos: [],
    failClaim: null,
    updates: [],
    sent: [],
    sesFails: false,
    ...overrides,
  };
}

const call = (args: Record<string, unknown>) => ({ info: { fieldName: 'boothEmailMyLink' }, arguments: args });

describe('boothEmailMyLink', () => {
  afterEach(() => jest.restoreAllMocks());

  it('emails the saved address and returns it masked', async () => {
    const world = freshWorld();
    const handler = load(world);
    const r = await handler(call({ key: KEY }));
    expect(r).toMatchObject({ ok: true, sent: true, emailHint: 'j***@example.com' });
    expect(world.sent).toEqual([{ to: 'jane@example.com', subject: 'Your SharePix photo link for Gala' }]);
    // Claimed (stamped) before the send.
    expect(world.updates.some((u) => u.expr.includes('linkEmailedAt'))).toBe(true);
  });

  it('answers a bad or unknown key the same way, without sending', async () => {
    const world = freshWorld();
    const handler = load(world);
    const short = await handler(call({ key: 'short' }));
    expect(short).toMatchObject({ ok: false, sent: false, emailHint: null, message: 'This link is not valid.' });
    expect(world.sent).toHaveLength(0);
  });

  it('sends nothing to someone who stopped emails', async () => {
    const world = freshWorld({ attendee: baseAttendee({ emailsStopped: { BOOL: true } }) });
    const handler = load(world);
    const r = await handler(call({ key: KEY }));
    expect(r).toMatchObject({ ok: false, sent: false, emailHint: null });
    expect(world.sent).toHaveLength(0);
  });

  it('sends once when the claim is lost (double tap, cooldown) or already stamped', async () => {
    const lost = freshWorld({ failClaim: 'linkEmailedAt' });
    const r = await load(lost)(call({ key: KEY }));
    expect(r).toMatchObject({ ok: true, sent: false, emailHint: 'j***@example.com' });
    expect(lost.sent).toHaveLength(0);

    const recent = freshWorld({
      attendee: baseAttendee({ linkEmailedAt: { S: new Date().toISOString() }, linkEmailCount: { N: '1' } }),
    });
    expect(await load(recent)(call({ key: KEY }))).toMatchObject({ sent: false });
    expect(recent.sent).toHaveLength(0);
  });

  it('releases the claim when the email fails to send', async () => {
    const world = freshWorld({ sesFails: true });
    const r = await load(world)(call({ key: KEY }));
    expect(r).toMatchObject({ ok: false, sent: false });
    expect(world.updates.some((u) => u.expr.startsWith('REMOVE linkEmailedAt'))).toBe(true);
  });

  it('with no address: saves the one given only with the tick, and never replaces one on file', async () => {
    const none = freshWorld({ attendee: baseAttendee() });
    delete none.attendee.email;
    const handler = load(none);
    // Asking whether there is an address: nothing saved, nothing sent.
    expect(await handler(call({ key: KEY }))).toMatchObject({ ok: true, sent: false, emailHint: null });
    // No tick: refused.
    expect(await handler(call({ key: KEY, email: 'new@example.com', consent: false }))).toMatchObject({ ok: false });
    expect(none.sent).toHaveLength(0);
    // With the tick: saved (conditionally) and sent.
    const r = await handler(call({ key: KEY, email: 'New@Example.com', consent: true }));
    expect(r).toMatchObject({ ok: true, sent: true, emailHint: 'n***@example.com' });
    expect(none.sent[0].to).toBe('new@example.com');

    // An address already on file is never swapped for one typed by a key holder.
    const has = freshWorld();
    const r2 = await load(has)(call({ key: KEY, email: 'attacker@example.com', consent: true }));
    expect(r2).toMatchObject({ emailHint: 'j***@example.com' });
    expect(has.sent.every((s) => s.to === 'jane@example.com')).toBe(true);
  });
});

describe('prompt delivery after a host approves', () => {
  afterEach(() => jest.restoreAllMocks());
  const approved = (n: number): Item[] =>
    Array.from({ length: n }, (_, i) => ({
      id: { S: `p${i}` },
      boothMatch: { S: 'person' },
      boothAttendeeId: { S: 'att1' },
      publishStatus: { S: 'approved' },
    }));
  const task = { task: 'deliver-now', eventId: 'ev1', attendeeIds: ['att1', 'att1'], settleMs: 0 };

  it('claims the count, then sends "ready" once', async () => {
    const world = freshWorld({ photos: approved(2) });
    const handler = load(world);
    const mod = await handler({ ...task });
    expect(mod).toMatchObject({ ok: true });
    expect(world.sent).toHaveLength(1);
    expect(world.sent[0].subject).toMatch(/ready|photo/i);
    expect(world.updates.some((u) => u.expr.includes('deliveredCount'))).toBe(true);
  });

  it('sends nothing when the hourly job already claimed it', async () => {
    const world = freshWorld({ photos: approved(2), failClaim: 'deliveredCount' });
    await load(world)({ ...task });
    expect(world.sent).toHaveLength(0);
  });

  it('sends nothing to someone who stopped emails, or for a "more" inside 10 minutes', async () => {
    const stopped = freshWorld({ photos: approved(2), attendee: baseAttendee({ emailsStopped: { BOOL: true } }) });
    await load(stopped)({ ...task });
    expect(stopped.sent).toHaveLength(0);

    const soon = freshWorld({
      photos: approved(3),
      attendee: baseAttendee({ deliveredCount: { N: '2' }, lastDeliveredAt: { S: new Date().toISOString() } }),
    });
    await load(soon)({ ...task });
    expect(soon.sent).toHaveLength(0);
  });

  it('cannot be reached through AppSync', async () => {
    const world = freshWorld({ photos: approved(2) });
    const handler = load(world);
    await handler({ info: { fieldName: 'boothResendEmail' }, arguments: {}, task: 'deliver-now', eventId: 'ev1', attendeeIds: ['att1'] }).catch(() => undefined);
    expect(world.sent).toHaveLength(0);
  });
});

describe('wiring', () => {
  const handler = codeOnly(readSource('amplify/functions/booth-deliveries/handler.ts'));
  it('claims before every send and releases on failure', () => {
    const link = handler.slice(handler.indexOf('async function emailMyLink'), handler.indexOf('const sleep'));
    expect(link.indexOf('linkEmailedAt = :now')).toBeGreaterThan(-1);
    expect(link.indexOf('UpdateItemCommand')).toBeLessThan(link.indexOf("sendEmail(attendee, event, 'session'"));
    const now = handler.slice(handler.indexOf('async function deliverNow'), handler.indexOf('interface InvocationEvent'));
    expect(now.indexOf('claimDelivery(attendee, total, nowISO)')).toBeLessThan(now.indexOf('send(attendee, event, kind, total)'));
    expect(now).toContain('releaseDelivery(attendee, total)');
  });

  it('lets only decide-pro-photo invoke booth-deliveries, asynchronously, after a booth approval', () => {
    const backend = codeOnly(readSource('amplify/backend.ts'));
    expect(backend).toContain('boothDeliveriesFn.grantInvoke(decideProFn)');
    expect(backend).toContain("decideProFn.addEnvironment('BOOTH_DELIVERIES_FUNCTION_NAME', boothDeliveriesFn.functionName)");
    const decide = codeOnly(readSource('amplify/functions/decide-pro-photo/handler.ts'));
    expect(decide).toContain("InvocationType: 'Event'");
    expect(decide).toContain("task: 'deliver-now'");
    expect(decide).toMatch(/boothPhoto && !boothToGallery && decision === 'approve'/);
  });

  it('exposes the mutation to guests and the masked hint on the gallery view', () => {
    const schema = codeOnly(readSource('amplify/data/resource.ts'));
    const mutation = schema.slice(schema.indexOf('boothEmailMyLink:'), schema.indexOf('BoothLinkEmailResult: a.customType'));
    expect(mutation).toContain('allow.guest()');
    expect(mutation).toContain('boothDeliveriesFn');
    expect(codeOnly(readSource('amplify/functions/booth-gallery/handler.ts'))).toContain('emailHint');
  });
});
