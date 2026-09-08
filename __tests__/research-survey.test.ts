import { ARCHIVE_DAYS, GALLERY_MONTHS, UPLOAD_WINDOW_DAYS, getTier } from '../lib/pricing';
import { INCENTIVE_AMOUNT_USD } from '../lib/researchIncentive';
import { readSource } from './sourceGuards';

/**
 * The research survey's question set, checked against the product it asks about.
 *
 * The survey lives in a form provider, so nothing here could stop it describing
 * a product we no longer sell — and it did exactly that: 90-day retention, a
 * $49 price and a photo cap, all true once and none true now. A respondent
 * answering "was that fair?" about a price they were never charged produces
 * noise that looks like data.
 *
 * docs/research-survey.md is now the source of truth for the wording, and this
 * pins its numbers to the code. It cannot prove the FORM matches the document —
 * that stays a manual step, and the document says so.
 */

const doc = readSource('docs/research-survey.md');

describe('the survey states the product we actually sell', () => {
  it('names the paid plan and its price as they stand', () => {
    const paid = getTier('plus');
    expect(paid).toBeDefined();
    expect(doc).toContain(`**${paid!.name}**`);
    expect(doc).toContain(`**$${paid!.price}**`);
  });

  it('states the gallery retention, not the archive window', () => {
    // The specific error: the old form said 90 days, which is the ARCHIVE, and
    // understated what a host actually keeps by a factor of four.
    expect(doc).toContain(`**${GALLERY_MONTHS} months**`);
    expect(doc).toContain(`**${ARCHIVE_DAYS}-day private archive**`);
  });

  it('states the upload window', () => {
    expect(doc).toContain(`**${UPLOAD_WINDOW_DAYS}-day upload window**`);
  });

  it('states the incentive amount the code will actually pay', () => {
    expect(doc).toContain(`**$${INCENTIVE_AMOUNT_USD} Amazon gift card**`);
  });

  it('describes photos as unlimited and video as capped', () => {
    const paid = getTier('plus');
    expect(paid!.photoLimit).toBeNull();
    expect(doc).toContain('**unlimited photos**');
    expect(doc).toContain(`**${paid!.videoLimit} videos**`);
  });

  it('describes the free tier that now exists', () => {
    // The old survey predates it entirely, which is why a screening question
    // had to be added: a free-trial host and a paying host answering the same
    // price question are two different measurements.
    const free = getTier('free');
    expect(doc).toContain(`${free!.photoLimit} photos`);
    expect(doc).toContain(`${free!.retentionDays}-day gallery`);
  });
});

describe('the research rules the questions follow', () => {
  it('says the gift card does not depend on the answers', () => {
    // The same promise the landing page makes. If it were conditional we would
    // be paying for agreement rather than learning anything.
    expect(doc).toMatch(/does not depend on the answers/i);
  });

  it('refuses to route respondents by sentiment', () => {
    // Asking happy people for a public review and unhappy people for a support
    // ticket is review gating — the line lib/customerRating.ts draws.
    expect(doc).toMatch(/review gating/i);
    expect(doc).toContain('lib/customerRating.ts');
  });

  it('keeps testimonial consent out of the research survey', () => {
    // Folding consent in here would make the gift card look conditional on
    // saying something nice, which is the one thing that must not slip.
    const absent = doc.slice(doc.indexOf('Not asked, on purpose'));
    expect(absent.length).toBeGreaterThan(0);
    expect(absent).toMatch(/consent for a testimonial is\s*\n?collected separately/i);
  });
});

describe('what the document admits it cannot do', () => {
  it('says updating the form is a manual step', () => {
    // A test that proves the doc matches the code, read carelessly, looks like
    // a test that proves the survey is correct. It is not, and the document
    // has to say so where someone will read it.
    expect(doc).toMatch(/Editing the form is a manual step/i);
  });

  it('points at the environment variable the form actually lives behind', () => {
    expect(doc).toContain('NEXT_PUBLIC_RESEARCH_SURVEY_URL');
    expect(readSource('pages/survey/[link].tsx')).toContain(
      'NEXT_PUBLIC_RESEARCH_SURVEY_URL',
    );
  });
});
