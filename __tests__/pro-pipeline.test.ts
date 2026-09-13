import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * The professional upload path, checked at its edges.
 *
 * These are source guards rather than unit tests because the properties that
 * matter here are about what the code is allowed to reach — IAM grants, which
 * table a fact comes from, whether a delete can happen before a write — and
 * those are not observable from a return value.
 */

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('the duplicated modules have not drifted', () => {
  // Amplify functions bundle separately and take no cross-bundle imports, so
  // these exist twice. The copies must stay identical below their headers.
  it.each([
    ['professionalMedia', 'pro-upload'],
    ['photographerAccess', 'pro-upload'],
    ['professionalMedia', 'process-pro-photo'],
    ['photographerAccess', 'process-pro-photo'],
    ['proProcessing', 'process-pro-photo'],
    ['professionalMedia', 'decide-pro-photo'],
    ['photographerAccess', 'decide-pro-photo'],
  ])('%s in %s', (name, fn) => {
    const original = readSource(`lib/${name}.ts`);
    const copy = readSource(`amplify/functions/${fn}/${name}.ts`);
    expect(bodyOf(copy)).toBe(bodyOf(original));
  });
});

describe('nothing but a Lambda can reach the pro prefix', () => {
  it('has no storage access rule for it', () => {
    // This is what makes "an original is never publicly exposed" a fact about
    // IAM rather than a promise in the UI. Amplify storage paths take a
    // wildcard only at the end, so an exception under events/ is impossible —
    // which is why pro/ is a top-level prefix with no rule at all.
    const storage = read('amplify', 'storage', 'resource.ts');
    expect(storage).not.toMatch(/['"]pro\//);
  });

  it('grants the signer write but never read', () => {
    // A signer that could read is a signer that could hand out a read URL.
    const backend = codeOnly(read('amplify', 'backend.ts'));
    expect(backend).toContain('bucket.grantPut(proUploadFn)');
    expect(backend).not.toMatch(/bucket\.grantRead\w*\(proUploadFn\)/);
    expect(backend).not.toMatch(/bucket\.grantDelete\(proUploadFn\)/);
  });
});

describe('the upload slot', () => {
  const handler = codeOnly(read('amplify', 'functions', 'pro-upload', 'handler.ts'));

  it('builds the key itself rather than taking one', () => {
    // A presigned URL is a capability: whatever it is signed for is what the
    // holder can write. A caller-supplied key could aim at another event's
    // prefix, at previews, or at a key already holding somebody's photo.
    expect(handler).toContain('professionalKeys(eventId, uploadId)');
    expect(handler).toContain('randomUUID()');
    expect(handler).not.toMatch(/arguments\.(key|objectKey|uploadId)/);
  });

  it('takes the photographer from the token, never the body', () => {
    expect(handler).toContain("'sub' in event.identity");
    expect(handler).not.toMatch(/arguments\.photographerId/);
  });

  it('checks the connection against this event and this caller', () => {
    expect(handler).toContain('mayUploadToEvent(connection, eventId, sub)');
  });

  it('gives one answer for every way of not being allowed', () => {
    // Anything more specific maps which events exist and who shoots them.
    const messages = handler.match(/throw new Error\('([^']+)'\)/g) ?? [];
    expect(new Set(messages).size).toBe(1);
  });
});

describe('the processor', () => {
  const handler = codeOnly(read('amplify', 'functions', 'process-pro-photo', 'handler.ts'));

  it('authorizes before it reads a single byte', () => {
    // Sliced from the handler, not the whole file: the imports and the helper
    // that wraps GetObjectCommand both sit above it, and comparing raw file
    // offsets compared against an import line rather than a call.
    const body = handler.slice(handler.indexOf('export const handler'));
    expect(body.indexOf('mayUploadToEvent')).toBeGreaterThan(-1);
    expect(body.indexOf('mayUploadToEvent')).toBeLessThan(body.indexOf('bodyOf(keys.original)'));
    expect(body.indexOf('mayUploadToEvent')).toBeLessThan(body.indexOf('HeadObjectCommand'));
  });

  it('is idempotent on the upload id', () => {
    // The future Bridge queues uploads offline and retries them. A retry that
    // produced a second gallery tile would be worse than one that failed.
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(id)'");
    expect(handler).toContain('ConditionalCheckFailedException');
  });

  it('writes the row before it considers deleting anything', () => {
    expect(handler.indexOf('PutItemCommand')).toBeLessThan(handler.indexOf('discardDecision'));
  });

  it('routes every discard through the tested decision', () => {
    // Not an `if` in a catch block. A photographer may have formatted the card.
    expect(handler).toContain('discardDecision({ previewWritten, thumbnailWritten, keepOriginal })');
    expect(handler).toContain('if (discard.discard)');
  });

  it('never fails an upload because a cleanup delete failed', () => {
    // A file left behind is a bill. Failing here would be an incident.
    const afterDiscard = handler.slice(handler.indexOf('if (discard.discard)'));
    expect(afterDiscard).toContain('.catch(() => null)');
  });

  it('starts the photo where a guest cannot see it', () => {
    expect(handler).toContain("publishStatus: { S: 'awaiting_review' }");
    expect(handler).not.toContain("publishStatus: { S: 'published' }");
  });

  it('takes its defaults from defaultsFor rather than writing them out', () => {
    // Assembling this state by hand is how one ends up with
    // downloadAllowed: true on somebody's wedding photograph.
    expect(handler).toContain('defaultsFor(longEdge)');
    expect(handler).toContain('downloadAllowed: { BOOL: defaults.downloadAllowed }');
    expect(handler).not.toMatch(/downloadAllowed: \{ BOOL: true \}/);
  });

  it('applies a watermark to the derivative only', () => {
    const stamp = handler.indexOf('stampWatermark(image');
    expect(stamp).toBeGreaterThan(-1);
    // It happens after the resize and before the preview is encoded, so the
    // stored original is untouched whatever the setting says.
    expect(stamp).toBeGreaterThan(handler.indexOf('image.resize'));
    expect(stamp).toBeLessThan(handler.indexOf("getBuffer('image/jpeg'"));
  });
});

describe('the decision handler', () => {
  const handler = codeOnly(read('amplify', 'functions', 'decide-pro-photo', 'handler.ts'));

  it('only ever touches the photographer’s own photo', () => {
    // Not the host's, not another photographer on the same event. A
    // photographer decides what happens to their own work and nobody else's.
    expect(handler).toContain('photo.photographerId?.S !== sub');
  });

  it('refuses to reach a guest photo through this path', () => {
    // A guest photo has no publish status and must not acquire one here.
    expect(handler).toContain("photo.sourceType?.S !== 'professional'");
  });

  it('re-checks the transition server-side', () => {
    expect(handler).toContain('canTransition(from, target)');
  });

  it('re-checks the connection, so a removed photographer stops immediately', () => {
    expect(handler).toContain('mayReviewEvent(connection, photoEventId, sub)');
  });

  it('writes only from the status it checked', () => {
    // Two tabs open on one queue must not both win, and a stale button must
    // not undo a decision already made.
    expect(handler).toContain("ConditionExpression: 'publishStatus = :from'");
  });

  it('lets an approval publish only when the photographer is live', () => {
    expect(handler).toContain('shouldPublishOnApproval({ livePublishing: live, mode })');
  });

  it('keeps the gallery’s own flag in step with publication', () => {
    // `approved` is what the existing gallery reads. If the two disagreed, a
    // photo could be visible in one and not the other.
    expect(handler).toContain("':approved': { BOOL: landing === 'published' }");
  });

  it('gives one answer for every way of not being allowed', () => {
    expect(handler).toContain('const DENIED =');
    const thrown = handler.match(/throw new Error\(DENIED\)/g) ?? [];
    expect(thrown.length).toBeGreaterThanOrEqual(4);
  });

  it('has no bucket access at all', () => {
    // Deciding what a guest sees never needs to touch an object.
    const backend = codeOnly(read('amplify', 'backend.ts'));
    expect(backend).not.toMatch(/bucket\.grant\w*\(decideProFn\)/);
  });
});
