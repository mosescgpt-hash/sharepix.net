import { codeOnly, readSource } from './sourceGuards';

/**
 * How the public gallery reads an event's photos.
 *
 * This is the hottest read in SharePix — every gallery open and every slideshow
 * poll — and it used to be a Scan of the whole Photo table with a filter, so its
 * cost was total photos stored multiplied by views. The index it needed already
 * existed.
 */

const handler = readSource('amplify/functions/list-event-photos/handler.ts');
const code = codeOnly(handler);

describe('the query', () => {
  it('uses the eventId index rather than scanning the table', () => {
    expect(code).toContain('new QueryCommand(');
    expect(code).toContain('IndexName: PHOTOS_BY_EVENT_INDEX');
    expect(code).toContain('KeyConditionExpression');
  });

  it('names the index Amplify actually generates', () => {
    // Verified against the synthesised template: `index('eventId')` on Photo
    // produces `photosByEventId`, not `eventId-index`. Getting this wrong
    // fails at runtime, on every gallery, not at build time.
    expect(code).toContain("const PHOTOS_BY_EVENT_INDEX = 'photosByEventId';");
  });

  it('is still backed by that index in the schema', () => {
    // The Lambda cannot read the schema, so this is what ties the hard-coded
    // name to the declaration that generates it.
    const schema = readSource('amplify/data/resource.ts');
    const photo = schema.slice(schema.indexOf('Photo: a'), schema.indexOf('Moment: a'));
    expect(photo).toContain("secondaryIndexes((index) => [index('eventId')])");
  });

  it('reads every page', () => {
    // Truncating here would silently drop photos from a gallery, which is
    // worse than being slow.
    expect(code).toContain('ExclusiveStartKey: startKey');
    expect(code).toContain('while (startKey)');
  });
});

describe('the scan that is left', () => {
  it('exists only as a fallback, not as the normal path', () => {
    const query = code.indexOf('new QueryCommand(');
    const scan = code.indexOf('new ScanCommand(');
    expect(query).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(query);
  });

  it('says loudly when it is used', () => {
    // A fallback nobody notices is a Scan that came back permanently.
    expect(code).toContain('console.error(');
    expect(handler).toMatch(/Falling back to a full table scan/);
  });

  it('does not merge a partial query result into the scan', () => {
    // A partial page plus a full scan would list some photos twice.
    expect(code).toContain('const scanned: PhotoItem[] = [];');
    expect(code).toContain('return scanned;');
  });
});

describe('what the change did not touch', () => {
  it('still withholds photos held for review from guests', () => {
    // This query serves guests, so it is where screening is enforced.
    expect(code).toContain("item.moderationStatus?.S !== 'flagged'");
    expect(code).toContain('item.approved?.BOOL !== false');
  });

  it('still applies the per-viewer visibility rule', () => {
    expect(code).toContain('isVisibleTo(');
  });

  it('still returns nothing for a missing event id', () => {
    expect(code).toContain('if (!eventId) return [];');
  });
});
