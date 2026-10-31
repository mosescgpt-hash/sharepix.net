import { readSource, codeOnly } from './sourceGuards';

/**
 * A guest's phone showed "Photos were found but could not be loaded yet" on a
 * live slideshow because mediaUrls could not Query the Photo table's
 * photosByEventId index (the Lambda role had no permission for it), so its
 * guest allow-list came back empty and no photo was ever signed. The host was
 * never affected: the host skips the allow-list. These pin both halves of the fix.
 */

const E = 'evt-1';
const row = (id: string) => ({
  id: { S: id },
  s3Key: { S: `events/${E}/photos/${id}.jpg` },
  previewS3Key: { S: `events/${E}/previews/${id}-preview.jpg` },
  thumbS3Key: { S: `events/${E}/thumbs/${id}-thumb.jpg` },
  approved: { BOOL: true },
});

const sent: string[] = [];
let queryFails = false;
let scanFails = false;

jest.mock('@aws-sdk/client-dynamodb', () => {
  class Cmd {
    constructor(public input: Record<string, unknown>) {}
  }
  class GetItemCommand extends Cmd {}
  class BatchGetItemCommand extends Cmd {}
  class QueryCommand extends Cmd {}
  class ScanCommand extends Cmd {}
  class DynamoDBClient {
    async send(command: Cmd) {
      const name = command.constructor.name;
      sent.push(name);
      if (name === 'GetItemCommand') {
        return { Item: { id: { S: 'evt-1' }, owner: { S: 'host-sub::host' } } };
      }
      if (name === 'QueryCommand') {
        if (queryFails) throw new Error('not authorized to perform: dynamodb:Query');
        return { Items: [row('p1')] };
      }
      if (name === 'ScanCommand') {
        if (scanFails) throw new Error('not authorized to perform: dynamodb:Scan');
        return { Items: [row('p1')] };
      }
      return {};
    }
  }
  return { DynamoDBClient, GetItemCommand, BatchGetItemCommand, QueryCommand, ScanCommand };
});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {},
  GetObjectCommand: class {
    constructor(public input: { Key: string }) {}
  },
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_c: unknown, cmd: { input: { Key: string } }) => `https://s3.test/${cmd.input.Key}`,
}));

process.env.EVENT_TABLE_NAME = 'Event';
process.env.PHOTO_TABLE_NAME = 'Photo';
process.env.PHOTO_BUCKET_NAME = 'bucket';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handler } = require('../amplify/functions/media-url/handler') as {
  handler: (event: unknown) => Promise<{ key: string; url: string | null; fallbackUrl: string | null }[]>;
};

const guestCall = (keys: string[]) =>
  handler({
    arguments: { eventId: E, keys },
    identity: { cognitoIdentityId: 'us-east-1:guest-1' },
  });

const preview = `events/${E}/previews/p1-preview.jpg`;

beforeEach(() => {
  sent.length = 0;
  queryFails = false;
  scanFails = false;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('mediaUrls for a guest', () => {
  it('signs a visible photo through the index', async () => {
    const [out] = await guestCall([preview]);
    expect(out.fallbackUrl).toBe(`https://s3.test/${preview}`);
    expect(sent).toContain('QueryCommand');
    expect(sent).not.toContain('ScanCommand');
  });

  it('still signs it when the index cannot be queried, by scanning instead', async () => {
    queryFails = true;
    const [out] = await guestCall([preview]);
    expect(out.fallbackUrl).toBe(`https://s3.test/${preview}`);
    expect(sent).toContain('ScanCommand');
  });

  it('fails closed (signs nothing) when neither read works', async () => {
    queryFails = true;
    scanFails = true;
    const [out] = await guestCall([preview]);
    expect(out.url).toBeNull();
    expect(out.fallbackUrl).toBeNull();
  });

  it('never signs a photo that is not in the event allow-list', async () => {
    const other = `events/${E}/previews/someone-else-preview.jpg`;
    const [out] = await guestCall([other]);
    expect(out.fallbackUrl).toBeNull();
  });
});

describe('the Lambda roles are allowed to Query the index', () => {
  const backend = codeOnly(readSource('amplify/backend.ts'));
  it('grants Query on photosByEventId to mediaUrls and listEventPhotos', () => {
    for (const fn of ['mediaUrlFn', 'listFn']) {
      const at = backend.indexOf(`${fn}.addToRolePolicy(`);
      expect(at).toBeGreaterThan(-1);
      const statement = backend.slice(at, at + 260);
      expect(statement).toContain("'dynamodb:Query'");
      expect(statement).toContain('/index/photosByEventId');
    }
  });
});
