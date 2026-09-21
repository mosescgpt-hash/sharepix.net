import { codeOnly, readSource } from './sourceGuards';

/**
 * "Unless you ask us to keep them" — and until now there was nowhere to ask.
 *
 * `process-pro-photo` has read `keepOriginals` off the photographer's profile
 * since the feature was written, and `discardDecision` has honoured it, with
 * tests. But the field was never declared on `PhotographerProfile`, so the read
 * came back undefined every time, the answer was always "discard", and two
 * customer-facing pages promised otherwise.
 *
 * Nothing failed. A photographer's irreplaceable originals were deleted exactly
 * as the code intended, while the site told them they could opt out.
 *
 * These guards hold the four pieces together: the field exists, the pipeline
 * reads it, a photographer can set it, and the copy matches whichever way it is
 * set.
 */

describe('the field the pipeline reads actually exists', () => {
  const schema = codeOnly(readSource('amplify/data/resource.ts'));
  const pipeline = codeOnly(readSource('amplify/functions/process-pro-photo/handler.ts'));

  it('is declared on PhotographerProfile', () => {
    const model = schema.slice(
      schema.indexOf('PhotographerProfile: a'),
      schema.indexOf('EventPhotographer: a'),
    );
    expect(model).toContain('keepOriginals: a.boolean()');
  });

  it('is the same name the pipeline looks for', () => {
    // The whole bug in one line: a reader and a schema that never met.
    expect(pipeline).toContain('p?.keepOriginals?.BOOL === true');
  });

  it('still defaults to discarding', () => {
    // Absent means delete. Holding somebody else's copyrighted work has to be
    // asked for, not inherited.
    expect(pipeline).toContain('const keepOriginal = p?.keepOriginals?.BOOL === true;');
  });
});

describe('a photographer can actually ask', () => {
  const api = codeOnly(readSource('lib/api.ts'));
  const page = codeOnly(readSource('pages/pro/events/[eventId]/review.tsx'));

  it('keys the profile by the Cognito subject, not an auto-generated id', () => {
    // process-pro-photo fetches it with Key: { id: sub }. A row created with
    // Amplify's default id would never be found, and every setting on it would
    // be ignored in silence — the same shape as the owner-string bug.
    expect(api).toContain('{ id: user.userId }');
    expect(api).toContain('const input = { id: user.userId, keepOriginals };');
  });

  it('creates the row on first use rather than updating nothing', () => {
    // A photographer who has never opened a setting has no row, and the first
    // thing they do with one is this. An update against a missing row can
    // succeed against nothing.
    const fn = api.slice(api.indexOf('export async function setKeepOriginals'));
    expect(fn.slice(0, 900)).toContain('PhotographerProfile.create(input');
    expect(fn.slice(0, 900)).toContain('PhotographerProfile.update(input');
  });

  it('puts the control on the page that makes the promise', () => {
    expect(page).toContain('Keep my original files');
    expect(page).toContain('setKeepOriginalsSetting(next)');
  });

  it('reads the current value before drawing the box', () => {
    // Starting unchecked and flipping on load would show a change nobody made,
    // on a setting about whether somebody's originals survive.
    expect(page).toContain('getMyPhotographerProfile()');
    expect(page).toContain('useState<boolean | null>(null)');
  });

  it('puts the box back when the save fails', () => {
    // A checkbox that stays checked after a failed write is a photographer
    // believing their originals are kept when they are not.
    expect(page).toContain('setKeepOriginals(!next);');
  });
});

describe('the copy says what is actually configured', () => {
  const page = readSource('pages/pro/events/[eventId]/review.tsx');
  const landing = readSource('pages/pro/index.tsx');

  it('no longer claims an opt-out the upload panel cannot offer', () => {
    // It said "unless you have asked us to keep it" with no way to ask. It now
    // reflects the setting either way.
    expect(page).toContain('and keep your original, because you asked us to.');
    expect(page).toContain('and delete your original.');
  });

  it('the landing page promise is now keepable, and says where', () => {
    // Pinned as a property rather than a sentence: the page may reword the
    // promise, but it must not make it while the control does not exist. It
    // also now points at where the switch is, which the original did not.
    const prose = landing.replace(/\s+/g, ' ');
    expect(prose).toContain('unless you ask us to keep it');
    expect(prose).toContain('that switch is on the review page');
    expect(codeOnly(readSource('pages/pro/events/[eventId]/review.tsx'))).toContain(
      'Keep my original files',
    );
  });
});
