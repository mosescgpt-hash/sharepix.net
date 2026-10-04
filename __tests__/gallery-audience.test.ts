import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GALLERY_AUDIENCE_OPTIONS, galleryAudienceFor } from '../lib/galleryAudience';
import {
  GALLERY_AUDIENCES,
  audienceAllows,
  galleryAudienceOf,
  uploaderIdOf,
} from '../amplify/functions/list-event-photos/visibility';
import { buildPatch } from '../amplify/functions/update-event/settings';
import { readSource as read } from './sourceGuards';

describe('the two lists agree', () => {
  it('offers exactly the audiences the server enforces', () => {
    expect(GALLERY_AUDIENCE_OPTIONS.map((o) => o.key)).toEqual([...GALLERY_AUDIENCES]);
  });

  it('reads anything unknown as everyone, on both sides', () => {
    for (const value of [null, undefined, '', 'friends', 'HOST']) {
      expect(galleryAudienceOf(value)).toBe('everyone');
      expect(galleryAudienceFor({ galleryAudience: value })).toBe('everyone');
    }
    expect(galleryAudienceOf('own')).toBe('own');
    expect(galleryAudienceFor({ galleryAudience: 'host' })).toBe('host');
  });
});

describe('audienceAllows', () => {
  const mine = { uploaderId: 'guest-a' };
  const theirs = { uploaderId: 'guest-b' };
  const signedIn = { uploadedByUserId: 'user-1' };
  const old = {};

  it('lets everyone see everything by default', () => {
    for (const photo of [mine, theirs, old]) expect(audienceAllows('everyone', photo, '')).toBe(true);
  });

  it('shows a guest only their own uploads', () => {
    expect(audienceAllows('own', mine, 'guest-a')).toBe(true);
    expect(audienceAllows('own', theirs, 'guest-a')).toBe(false);
    expect(audienceAllows('own', signedIn, 'user-1')).toBe(true);
  });

  it('errs toward privacy for photos with no recorded uploader, and callers with no id', () => {
    expect(audienceAllows('own', old, 'guest-a')).toBe(false);
    expect(audienceAllows('own', { uploaderId: '' }, '')).toBe(false);
  });

  it('shows guests nothing when the host keeps it to themselves', () => {
    expect(audienceAllows('host', mine, 'guest-a')).toBe(false);
  });

  it('takes the uploader from the signed-in sub, else the guest identity', () => {
    expect(uploaderIdOf({ sub: 'user-1', cognitoIdentityId: 'us-east-1:x' })).toBe('user-1');
    expect(uploaderIdOf({ cognitoIdentityId: 'us-east-1:x' })).toBe('us-east-1:x');
    expect(uploaderIdOf(null)).toBe('');
  });
});

describe('saving the setting', () => {
  const state = { photoCount: 40, id: 'evt' };

  it('stores own and host, and clears for everyone', () => {
    expect(buildPatch({ galleryAudience: 'own' }, state)).toEqual({
      ok: true,
      patch: { set: { galleryAudience: 'own' }, remove: [] },
    });
    expect(buildPatch({ galleryAudience: 'HOST' }, state)).toEqual({
      ok: true,
      patch: { set: { galleryAudience: 'host' }, remove: [] },
    });
    expect(buildPatch({ galleryAudience: 'everyone' }, state)).toEqual({
      ok: true,
      patch: { set: {}, remove: ['galleryAudience'] },
    });
  });

  it('refuses anything else', () => {
    expect(buildPatch({ galleryAudience: 'friends' }, state).ok).toBe(false);
  });
});

describe('createEventPhoto records who uploaded', () => {
  it('from the verified identity, never the request', () => {
    const code = read('amplify/functions/create-event-photo/handler.ts');
    expect(code).toMatch(/who\?\.sub \|\| who\?\.cognitoIdentityId/);
    expect(code).toContain('item.uploaderId = { S: uploaderId }');
  });

  it('and the uploader id is never returned to guests', () => {
    const schema = read('amplify/data/resource.ts');
    const eventPhotoType = schema.slice(schema.indexOf('EventPhoto: a.customType'));
    expect(eventPhotoType.slice(0, eventPhotoType.indexOf('})'))).not.toContain('uploaderId');
  });
});

describe('listEventPhotos with the setting', () => {
  const OWNER = 'host-sub::host@example.com';
  type Item = Record<string, { S?: string; BOOL?: boolean }>;
  const photo = (id: string, extra: Item = {}): Item => ({
    id: { S: id },
    eventId: { S: 'evt' },
    s3Key: { S: `events/evt/photos/${id}.jpg` },
    eventOwner: { S: OWNER },
    ...extra,
  });
  const PHOTOS = [
    photo('a1', { uploaderId: { S: 'guest-a' } }),
    photo('b1', { uploaderId: { S: 'guest-b' } }),
    photo('old'),
  ];

  let audience: string | undefined;
  let takenDown = false;
  let share: Item | undefined;
  let handler: (event: unknown) => Promise<{ id: string }[]>;

  beforeAll(() => {
    process.env.PHOTO_TABLE_NAME = 'Photo';
    process.env.EVENT_TABLE_NAME = 'Event';
    process.env.DOWNLOAD_SHARE_TABLE_NAME = 'Share';
    jest.spyOn(DynamoDBClient.prototype, 'send').mockImplementation((async (command: {
      constructor: { name: string };
      input: { TableName?: string };
    }) => {
      const name = command.constructor.name;
      if (name === 'GetItemCommand' && command.input.TableName === 'Event') {
        return {
          Item: {
            owner: { S: OWNER },
            ...(takenDown ? { takenDownAt: { S: '2026-10-01T00:00:00Z' } } : {}),
            ...(audience ? { galleryAudience: { S: audience } } : {}),
          },
        };
      }
      if (name === 'GetItemCommand' && command.input.TableName === 'Share') {
        return { Item: share };
      }
      if (name === 'QueryCommand') return { Items: PHOTOS };
      throw new Error(`unexpected ${name}`);
    }) as never);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    handler = require('../amplify/functions/list-event-photos/handler').handler;
  });

  const list = async (identity: unknown, shareId?: string) =>
    (await handler({ arguments: { eventId: 'evt', shareId }, identity })).map((p) => p.id);

  const guestA = { cognitoIdentityId: 'guest-a' };
  const host = { sub: 'host-sub' };

  it('shows everyone everything by default', async () => {
    audience = undefined;
    expect(await list(guestA)).toEqual(['a1', 'b1', 'old']);
  });

  it('shows a guest their own, and the host everything', async () => {
    audience = 'own';
    expect(await list(guestA)).toEqual(['a1']);
    expect(await list({ cognitoIdentityId: 'guest-c' })).toEqual([]);
    expect(await list(host)).toEqual(['a1', 'b1', 'old']);
    expect(await list({ groups: ['ADMINS'], sub: 'admin' })).toEqual(['a1', 'b1', 'old']);
  });

  it('shows guests nothing in host-only mode', async () => {
    audience = 'host';
    expect(await list(guestA)).toEqual([]);
    expect(await list(host)).toEqual(['a1', 'b1', 'old']);
  });

  it('still lists nothing for a closed event, except to an admin', async () => {
    audience = undefined;
    takenDown = true;
    expect(await list(host)).toEqual([]);
    expect(await list({ groups: ['ADMINS'], sub: 'admin' })).toEqual(['a1', 'b1', 'old']);
    takenDown = false;
  });

  it('honours a host’s share link, for this event and unexpired only', async () => {
    audience = 'host';
    share = { eventId: { S: 'evt' }, photoIdsJson: { S: '["b1","old"]' } };
    expect(await list(guestA, 'share-1')).toEqual(['b1', 'old']);
    share = { eventId: { S: 'other' }, photoIdsJson: { S: '["b1"]' } };
    expect(await list(guestA, 'share-1')).toEqual([]);
    share = {
      eventId: { S: 'evt' },
      photoIdsJson: { S: '["b1"]' },
      expiresAt: { S: '2000-01-01T00:00:00Z' },
    };
    expect(await list(guestA, 'share-1')).toEqual([]);
  });
});

describe('storage does not undo it', () => {
  it('lets guests and signed-in users open files by key but not list a folder', () => {
    const rules = read('amplify/storage/resource.ts');
    const events = rules.slice(rules.indexOf("'events/*': ["), rules.indexOf("'demo/*'"));
    expect(events).toContain("allow.guest.to(['get', 'write'])");
    expect(events).toContain("allow.authenticated.to(['get', 'write'])");
    expect(events).not.toMatch(/allow\.(guest|authenticated)\.to\(\[[^\]]*'(read|list)'/);
  });

  it('and the browser never asks to list', () => {
    expect(read('lib/api.ts')).not.toMatch(/import \{[^}]*\blist\b[^}]*\} from 'aws-amplify\/storage'/);
  });
});
