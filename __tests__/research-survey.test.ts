import {
  ARCHIVE_DAYS,
  GALLERY_MONTHS,
  UPLOAD_WINDOW_DAYS,
  VIDEO_GB_INCLUDED,
  getTier,
} from '../lib/pricing';
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
    expect(doc).toContain(`**${VIDEO_GB_INCLUDED} GB of video**`);
    // Bounded by a budget rather than a count, but bounded either way.
    expect(paid!.videoBytesLimit).toBeGreaterThan(0);
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

describe('what the document is, now that the survey is in the product', () => {
  it('says it is not the wording', () => {
    // It was the source of truth while the survey lived in a form provider.
    // It is not any more, and two files claiming to define the same questions
    // is the drift this whole exercise existed to end.
    expect(doc).toMatch(/This file is not the wording/i);
  });

  it('points at the module that actually defines the questions', () => {
    expect(doc).toContain('lib/survey.ts');
    expect(doc).toContain('SURVEY_QUESTIONS');
  });

  it('tells the next editor to bump the version', () => {
    // Responses already collected have to keep meaning what they meant.
    expect(doc).toContain('SURVEY_VERSION');
  });

  it('is backed by a page that renders those definitions', () => {
    const page = readSource('pages/survey/[link].tsx');
    expect(page).toContain("from '@/lib/survey'");
    // The external form is gone; a page still reaching for it would mean the
    // host was sent somewhere this repository cannot see.
    expect(page).not.toContain('NEXT_PUBLIC_RESEARCH_SURVEY_URL');
  });
});
