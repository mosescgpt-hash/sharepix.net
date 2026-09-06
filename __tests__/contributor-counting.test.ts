import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How participation is counted, pinned at the source.
 *
 * Every one of these guards a mistake that produces a plausible-looking number
 * rather than an error: a metric that counts the host as a guest, or drifts
 * from the photo count, or trusts the browser about who is uploading. None of
 * them would fail a test of the happy path, and all of them would quietly make
 * the number mean nothing.
 */

const root = join(__dirname, '..');
const handler = readFileSync(
  join(root, 'amplify', 'functions', 'create-event-photo', 'handler.ts'),
  'utf8',
);
const backend = readFileSync(join(root, 'amplify', 'backend.ts'), 'utf8');
const schema = readFileSync(join(root, 'amplify', 'data', 'resource.ts'), 'utf8');

describe('who counts as a guest', () => {
  it('decides from the verified identity, never from the request', () => {
    // `uploadedByUserId` arrives in the arguments and is a claim. Deriving the
    // host check from it would let anyone mark their uploads as host uploads —
    // or a host mark theirs as guest uploads — and the metric would measure
    // nothing at all.
    expect(handler).toContain('const callerSub = (event.identity as { sub?: string } | undefined)?.sub');
    expect(handler).toContain('eventOwner.includes(callerSub)');
  });

  it('does not derive the host check from the client-supplied user id', () => {
    const block = handler.slice(
      handler.indexOf('const callerSub'),
      handler.indexOf('const isVideo = VIDEO_KEY.test(s3Key)'),
    );
    expect(block).not.toContain('uploadedByUserId');
  });

  it('treats anyone who is not the verified owner as a guest', () => {
    // The safe default: the failure mode is counting a second signed-in admin
    // as a guest, not silently dropping a real guest's contribution.
    expect(handler).toContain('const isGuestUpload = !isHostUpload');
  });
});

describe('the guest upload counter', () => {
  it('moves in the same atomic update as the slot reservation', () => {
    // A second write could succeed while the first failed, and the two numbers
    // would drift apart with no error anywhere.
    const start = handler.indexOf('// guestUploadCount rides along');
    expect(start).toBeGreaterThan(-1);
    const reservation = handler.slice(start, start + 600);
    expect(reservation).toContain("isGuestUpload ? 'guestUploadCount :one' : ''");
    expect(reservation).toContain("'ADD photoCount :one'");
  });

  it('is released with the slot when the photo record cannot be written', () => {
    const release = handler.slice(handler.indexOf('const releaseSlot ='));
    expect(release.slice(0, 800)).toContain("isGuestUpload ? 'guestUploadCount :neg' : ''");
  });
});

describe('the contributor record', () => {
  it('is a conditional put, so two guests uploading at once cannot both add one', () => {
    const fn = handler.slice(
      handler.indexOf('async function recordContributor'),
      handler.indexOf('async function fetchPhoto'),
    );
    expect(fn).toContain("ConditionExpression: 'attribute_not_exists(id)'");
    expect(fn).toContain('ConditionalCheckFailedException');
    expect(fn).toContain('contributorRowId(eventId, key)');
  });

  it('never fails the upload', () => {
    // This runs after the photo is already stored. A guest at a party must not
    // see their photo rejected because a counter did not move.
    const fn = handler.slice(
      handler.indexOf('async function recordContributor'),
      handler.indexOf('async function fetchPhoto'),
    );
    // Every failure path logs or returns; none rethrows.
    expect(fn).not.toMatch(/^\s*throw /m);
  });

  it('runs only for guest uploads, and only after the photo is stored', () => {
    const call = handler.indexOf('await recordContributor(eventId, uploadedBy, now)');
    expect(call).toBeGreaterThan(-1);
    expect(handler.slice(0, call)).toContain('if (isGuestUpload) {');
    // The photo PutItem must come first, or a failed write would leave a
    // contributor counted for a photo that does not exist.
    expect(handler.indexOf('TableName: PHOTO_TABLE,\n        Item: item,')).toBeLessThan(call);
  });

  it('does nothing when there is no key to identify a person', () => {
    // contributorKey returns null for a blank name and for the legacy
    // "Anonymous". Counting those would either invent people or collapse them.
    const fn = handler.slice(
      handler.indexOf('async function recordContributor'),
      handler.indexOf('async function fetchPhoto'),
    );
    expect(fn).toContain('if (!CONTRIBUTOR_TABLE || !key) return false;');
  });
});

describe('the wiring', () => {
  it('grants the upload function write access to the contributor table', () => {
    expect(backend).toContain('contributorTable.grantWriteData(createFn)');
    expect(backend).toContain("createFn.addEnvironment('CONTRIBUTOR_TABLE_NAME'");
  });

  it('keeps the contributor table admin-only', () => {
    // A host has no reason to enumerate their guests as data, and guests have
    // no reason to see each other.
    const start = schema.indexOf('EventContributor: a');
    const end = schema.indexOf(']),', schema.indexOf('.authorization(', start));
    const block = schema.slice(start, end + 3);
    expect(block).toContain("allow.group('ADMINS')");
    expect(block).not.toContain('allow.owner');
    expect(block).not.toContain('allow.guest');
    expect(block).not.toContain('allow.authenticated');
  });

  it('states that the counters are cumulative', () => {
    // Deleting a photo later does not un-count the guest who uploaded it. An
    // event must not become retroactively unsuccessful because a host tidied
    // their gallery.
    expect(schema).toContain('CUMULATIVE, not a live count');
  });
});
