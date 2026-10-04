import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHALLENGE_PRESETS,
  MAX_ACTIVE_CHALLENGES,
  MAX_CHALLENGE_TEXT,
  activeChallenges,
  challengeCaption,
  challengesWithPhotos,
  cleanChallengeText,
  photoCountsByChallenge,
  pickChallenge,
  sortChallenges,
  validateChallenge,
} from '../lib/challenges/rules';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();
const schema = read('amplify/data/resource.ts');
const block = (name: string) => {
  const start = schema.indexOf(`  ${name}: a`);
  return schema.slice(start, schema.indexOf('\n\n', start));
};

describe('the Lambda copies have not drifted', () => {
  it.each(['save-challenge', 'list-challenges'])('%s/rules.ts matches lib below the header', (fn) => {
    expect(bodyOf(read(`amplify/functions/${fn}/rules.ts`))).toBe(bodyOf(read('lib/challenges/rules.ts')));
  });
});

describe('schema', () => {
  it('gives the Challenge model to admins only; everyone else goes through the functions', () => {
    const model = block('Challenge');
    expect(model).toContain(".authorization((allow) => [allow.group('ADMINS')])");
    expect(model).not.toMatch(/allow\.(guest|owner|ownerDefinedIn|authenticated|publicApiKey)/);
  });

  it('lets only signed-in callers write, and checks ownership in the function', () => {
    for (const name of ['saveChallenge', 'removeChallenge', 'setChallengeSettings']) {
      const b = block(name);
      expect(b).toContain('.authorization((allow) => [allow.authenticated()])');
      expect(b).toContain('.handler(a.handler.function(saveChallengeFn))');
    }
    expect(read('amplify/functions/save-challenge/handler.ts')).toContain(
      "if (!found?.Item || !mayEdit(event.identity, found.Item.owner?.S ?? '')) return NOT_FOUND;",
    );
  });

  it('carries challengeId on photos, the upload mutation and the gallery list', () => {
    expect(schema.match(/challengeId: a\.string\(\),/g)?.length).toBe(3);
  });

  it('keeps a photo’s challenge only when the event has challenges on and the challenge is the event’s', () => {
    const handler = read('amplify/functions/create-event-photo/handler.ts');
    expect(handler).toContain("ev.challengesEnabled?.BOOL === true");
    expect(handler).toContain('if (challenge?.Item?.eventId?.S === eventId) challengeId = claimedChallenge;');
    expect(handler).toContain('if (challengeId) item.challengeId = { S: challengeId };');
  });
});

describe('presets', () => {
  it('has the ten wedding/party and ten convention prompts from the spec', () => {
    expect(CHALLENGE_PRESETS.party.prompts).toHaveLength(10);
    expect(CHALLENGE_PRESETS.convention.prompts).toHaveLength(10);
    expect(CHALLENGE_PRESETS.party.prompts[0]).toBe('A selfie with someone you just met');
    expect(CHALLENGE_PRESETS.convention.prompts[9]).toBe('Your badge');
  });

  it('are all valid challenges', () => {
    for (const set of Object.values(CHALLENGE_PRESETS)) {
      for (const p of set.prompts) expect(validateChallenge({ text: p })).toEqual({ ok: true, text: p, order: 0 });
    }
  });
});

describe('validateChallenge', () => {
  it('cleans whitespace and control characters', () => {
    expect(cleanChallengeText('  A\ttoast\n\nplease  ')).toBe('A toast please');
    expect(cleanChallengeText(42)).toBe('');
  });

  it('refuses empty and over-long prompts', () => {
    expect(validateChallenge({ text: '   ' }).ok).toBe(false);
    expect(validateChallenge({ text: 'x'.repeat(MAX_CHALLENGE_TEXT) }).ok).toBe(true);
    expect(validateChallenge({ text: 'x'.repeat(MAX_CHALLENGE_TEXT + 1) }).ok).toBe(false);
  });

  it('counts emoji as one character each', () => {
    expect(validateChallenge({ text: '🎉'.repeat(MAX_CHALLENGE_TEXT) }).ok).toBe(true);
  });

  it('clamps the order', () => {
    expect(validateChallenge({ text: 'a', order: -5 })).toMatchObject({ order: 0 });
    expect(validateChallenge({ text: 'a', order: 'x' })).toMatchObject({ order: 0 });
    expect(validateChallenge({ text: 'a', order: 3.6 })).toMatchObject({ order: 4 });
  });
});

const list = [
  { id: 'c', text: 'Shoes off', order: 2, active: true, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'a', text: 'A toast', order: 1, active: true, createdAt: '2026-01-02T00:00:00Z' },
  { id: 'b', text: 'Your view', order: 1, active: false, createdAt: '2026-01-01T00:00:00Z' },
];

describe('ordering and picking', () => {
  it('sorts by order, then age, then id', () => {
    expect(sortChallenges(list).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(activeChallenges(list).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('never repeats the prompt on screen when there is another', () => {
    const active = activeChallenges(list);
    for (const r of [0, 0.5, 0.999]) expect(pickChallenge(active, 'a', () => r)?.id).toBe('c');
    expect(pickChallenge([list[0]], 'c')?.id).toBe('c');
    expect(pickChallenge([])).toBeNull();
  });
});

describe('gallery and slideshow helpers', () => {
  const photos = [{ challengeId: 'a' }, { challengeId: 'a' }, { challengeId: 'b' }, {}, { challengeId: 'gone' }];

  it('counts photos per challenge', () => {
    expect(photoCountsByChallenge(photos)).toEqual(new Map([['a', 2], ['b', 1], ['gone', 1]]));
  });

  it('makes a chip only for challenges that have photos, inactive ones included', () => {
    expect(challengesWithPhotos(list, photos).map((c) => [c.id, c.count])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
  });

  it('captions a challenge photo unless the host switched captions off', () => {
    expect(challengeCaption({ challengeId: 'a' }, list, undefined)).toBe('A toast');
    expect(challengeCaption({ challengeId: 'a' }, list, true)).toBe('A toast');
    expect(challengeCaption({ challengeId: 'a' }, list, false)).toBeNull();
    expect(challengeCaption({ challengeId: 'gone' }, list, true)).toBeNull();
    expect(challengeCaption({}, list, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The functions, against an in-memory DynamoDB
// ---------------------------------------------------------------------------

type Item = Record<string, any>;

function setup() {
  jest.resetModules();
  process.env.EVENT_TABLE_NAME = 'Event';
  process.env.CHALLENGE_TABLE_NAME = 'Challenge';
  const tables: Record<string, Map<string, Item>> = { Event: new Map(), Challenge: new Map() };
  const fail = () => Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });

  class Cmd {
    constructor(public input: any) {}
  }
  class GetItemCommand extends Cmd {}
  class PutItemCommand extends Cmd {}
  class UpdateItemCommand extends Cmd {}
  class DeleteItemCommand extends Cmd {}
  class QueryCommand extends Cmd {}
  class ScanCommand extends Cmd {}
  class DynamoDBClient {
    async send(cmd: Cmd) {
      const { input } = cmd as any;
      const table = tables[input.TableName];
      const vals = input.ExpressionAttributeValues ?? {};
      const names = input.ExpressionAttributeNames ?? {};
      if (cmd instanceof GetItemCommand) return { Item: table.get(input.Key.id.S) };
      if (cmd instanceof QueryCommand || cmd instanceof ScanCommand) {
        return { Items: [...table.values()].filter((r) => r.eventId?.S === vals[':e'].S) };
      }
      if (cmd instanceof PutItemCommand) {
        if (table.has(input.Item.id.S)) throw fail();
        table.set(input.Item.id.S, input.Item);
        return {};
      }
      if (cmd instanceof DeleteItemCommand) {
        const item = table.get(input.Key.id.S);
        if (!item || item.eventId?.S !== vals[':e'].S) throw fail();
        table.delete(input.Key.id.S);
        return {};
      }
      if (cmd instanceof UpdateItemCommand) {
        const item = table.get(input.Key.id.S);
        if (input.ConditionExpression && (!item || item.eventId?.S !== vals[':e'].S)) throw fail();
        const next = { ...item };
        for (const part of input.UpdateExpression.replace(/^SET /, '').split(',')) {
          const [k, v] = part.split('=').map((x: string) => x.trim());
          next[names[k] ?? k] = vals[v];
        }
        table.set(input.Key.id.S, next);
        return {};
      }
      throw new Error('unexpected');
    }
  }
  jest.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient,
    GetItemCommand,
    PutItemCommand,
    UpdateItemCommand,
    DeleteItemCommand,
    QueryCommand,
    ScanCommand,
  }));
  tables.Event.set('ev1', { id: { S: 'ev1' }, owner: { S: 'host::host' } });
  tables.Event.set('ev2', { id: { S: 'ev2' }, owner: { S: 'other::other' }, challengesEnabled: { BOOL: true } });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const save = require('../amplify/functions/save-challenge/handler').handler;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const list = require('../amplify/functions/list-challenges/handler').handler;
  return { tables, save, list };
}

const host = { sub: 'host' };
const call = (fn: any, fieldName: string, args: Item, identity: Item | null = host) =>
  fn({ arguments: args, identity, info: { fieldName } });

describe('save-challenge', () => {
  it('adds, edits and removes a challenge on the host’s own event', async () => {
    const { tables, save } = setup();
    const added = await call(save, 'saveChallenge', { eventId: 'ev1', text: '  A toast ', order: 1 });
    expect(added).toMatchObject({ ok: true, challenge: { text: 'A toast', active: true, eventId: 'ev1' } });
    const id = added.challenge.id;
    const edited = await call(save, 'saveChallenge', { eventId: 'ev1', challengeId: id, text: 'A big toast', order: 1, active: false });
    expect(edited.ok).toBe(true);
    expect(tables.Challenge.get(id)!.active.BOOL).toBe(false);
    expect((await call(save, 'removeChallenge', { eventId: 'ev1', challengeId: id })).ok).toBe(true);
    expect(tables.Challenge.size).toBe(0);
  });

  it('refuses a stranger, a guest, and another event’s challenge', async () => {
    const { tables, save } = setup();
    expect((await call(save, 'saveChallenge', { eventId: 'ev1', text: 'x' }, { sub: 'stranger' })).ok).toBe(false);
    expect((await call(save, 'saveChallenge', { eventId: 'ev1', text: 'x' }, null)).ok).toBe(false);
    tables.Challenge.set('theirs', { id: { S: 'theirs' }, eventId: { S: 'ev2' }, text: { S: 't' } });
    // The host owns ev1, so they get past the owner check, but the challenge is ev2's.
    expect((await call(save, 'removeChallenge', { eventId: 'ev1', challengeId: 'theirs' })).ok).toBe(false);
    expect((await call(save, 'saveChallenge', { eventId: 'ev1', challengeId: 'theirs', text: 'mine now' })).ok).toBe(false);
    expect(tables.Challenge.get('theirs')!.text.S).toBe('t');
  });

  it(`stops at ${MAX_ACTIVE_CHALLENGES} active, but takes inactive ones`, async () => {
    const { save } = setup();
    for (let i = 0; i < MAX_ACTIVE_CHALLENGES; i += 1) {
      expect((await call(save, 'saveChallenge', { eventId: 'ev1', text: `Prompt ${i}` })).ok).toBe(true);
    }
    const over = await call(save, 'saveChallenge', { eventId: 'ev1', text: 'One more' });
    expect(over).toMatchObject({ ok: false });
    expect(over.message).toContain('20 active');
    const parked = await call(save, 'saveChallenge', { eventId: 'ev1', text: 'Later', active: false });
    expect(parked.ok).toBe(true);
    const activate = await call(save, 'saveChallenge', { eventId: 'ev1', challengeId: parked.challenge.id, text: 'Later', active: true });
    expect(activate.ok).toBe(false);
  });

  it('refuses a prompt over 60 characters', async () => {
    const { save } = setup();
    expect((await call(save, 'saveChallenge', { eventId: 'ev1', text: 'x'.repeat(61) })).ok).toBe(false);
  });

  it('sets the switch and captions', async () => {
    const { tables, save } = setup();
    expect((await call(save, 'setChallengeSettings', { eventId: 'ev1', enabled: true, captions: false })).ok).toBe(true);
    expect(tables.Event.get('ev1')!.challengesEnabled.BOOL).toBe(true);
    expect(tables.Event.get('ev1')!.challengeCaptions.BOOL).toBe(false);
  });
});

describe('list-challenges', () => {
  it('gives guests nothing while the switch is off, and the host everything', async () => {
    const { tables, save, list } = setup();
    await call(save, 'saveChallenge', { eventId: 'ev1', text: 'A toast', order: 2 });
    await call(save, 'saveChallenge', { eventId: 'ev1', text: 'Shoes off', order: 1, active: false });
    expect(await list({ arguments: { eventId: 'ev1' }, identity: null })).toEqual([]);
    const forHost = await list({ arguments: { eventId: 'ev1' }, identity: host });
    expect(forHost.map((c: any) => c.text)).toEqual(['Shoes off', 'A toast']);

    tables.Event.get('ev1')!.challengesEnabled = { BOOL: true };
    const forGuest = await list({ arguments: { eventId: 'ev1' }, identity: null });
    expect(forGuest.map((c: any) => [c.text, c.active])).toEqual([
      ['Shoes off', false],
      ['A toast', true],
    ]);

    tables.Event.get('ev1')!.takenDownAt = { S: '2026-06-06T00:00:00Z' };
    expect(await list({ arguments: { eventId: 'ev1' }, identity: null })).toEqual([]);
  });

  it('returns nothing for an unknown event', async () => {
    const { list } = setup();
    expect(await list({ arguments: { eventId: 'nope' }, identity: null })).toEqual([]);
  });
});
