import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONSENT_VERSION,
  DEFAULT_DISPLAY_MODE,
  POSITIVE_RATING_MIN,
  branchFor,
  cleanText,
  consentFrom,
  displayNameFor,
  isDisplayMode,
  mayPublish,
  normalizeRating,
  summarize,
} from '../lib/customerRating';
import { decodeRatingLink, encodeRatingLink } from '../lib/ratingLink';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

describe('the copies have not drifted', () => {
  it.each([
    ['submit-feedback', 'customerRating'],
    ['submit-feedback', 'ratingLink'],
    ['daily-tasks', 'customerRating'],
    ['daily-tasks', 'ratingLink'],
  ])('keeps %s/%s byte-identical with lib/', (fn, name) => {
    expect(bodyOf(read(`amplify/functions/${fn}/${name}.ts`))).toBe(bodyOf(read(`lib/${name}.ts`)));
  });
});

describe('the score', () => {
  it('accepts only whole numbers on the scale', () => {
    expect(normalizeRating(1)).toBe(1);
    expect(normalizeRating(5)).toBe(5);
    expect(normalizeRating(0)).toBeNull();
    expect(normalizeRating(6)).toBeNull();
    expect(normalizeRating(4.5)).toBeNull();
    // A string that looks like a rating is not a rating. Stored as one it
    // would be a value somebody eventually averages.
    expect(normalizeRating('5')).toBeNull();
    expect(normalizeRating(null)).toBeNull();
    expect(normalizeRating(undefined)).toBeNull();
  });
});

describe('which branch a score takes', () => {
  it('sends 4 and 5 to a testimonial', () => {
    expect(branchFor(4)).toBe('testimonial');
    expect(branchFor(5)).toBe('testimonial');
    expect(POSITIVE_RATING_MIN).toBe(4);
  });

  it('sends 1, 2 and 3 to support', () => {
    for (const score of [1, 2, 3]) expect(branchFor(score)).toBe('support');
  });

  it('has no branch at all for an unrated event', () => {
    expect(branchFor(null)).toBeNull();
  });

  it('never routes anyone to a third-party review site', () => {
    // Asking only satisfied customers to review on a platform SharePix does
    // not own is review gating: the score becomes a filter on who is invited
    // to speak, and the public record it produces is skewed by design. A
    // testimonial on our own pages is advertising copy and a different thing.
    //
    // This is a source guard because the rule is only worth anything if it
    // survives the next person adding "and leave us a Google review" to the
    // happy path.
    const sources = [
      read('lib/customerRating.ts'),
      read('pages/rating/[link].tsx'),
      read('amplify/functions/submit-feedback/handler.ts'),
    ].join('\n');
    // Skip the block comments, which explain exactly why these are absent.
    const code = sources.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['g.page/', 'goo.gl', 'search.google', 'trustpilot', 'g2.com']) {
      expect(code.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('permission', () => {
  it('grants only on an explicit true', () => {
    expect(consentFrom(true).granted).toBe(true);
    // Everything a sloppy client might send instead. Reading a stray truthy
    // value as consent means publishing someone's words without it.
    for (const value of ['true', 1, {}, [], 'yes', null, undefined, false]) {
      expect(consentFrom(value).granted).toBe(false);
    }
  });

  it('records which wording was agreed to', () => {
    expect(consentFrom(true).consentVersion).toBe(CONSENT_VERSION);
    expect(consentFrom(true).consentText).toMatch(/marketing/i);
  });

  it('defaults a name to anonymous', () => {
    expect(DEFAULT_DISPLAY_MODE).toBe('anonymous');
    expect(isDisplayMode('anonymous')).toBe(true);
    expect(isDisplayMode('full_legal_name')).toBe(false);
  });
});

describe('what may be published', () => {
  const approved = {
    rating: 5,
    testimonialText: 'It worked.',
    marketingPermission: true,
    status: 'APPROVED',
  };

  it('needs permission, words and an approval together', () => {
    expect(mayPublish(approved)).toBe(true);
    expect(mayPublish({ ...approved, marketingPermission: false })).toBe(false);
    expect(mayPublish({ ...approved, testimonialText: '   ' })).toBe(false);
    expect(mayPublish({ ...approved, status: 'NEW' })).toBe(false);
    expect(mayPublish(null)).toBe(false);
  });

  it('stops publishing the moment permission is withdrawn, approval or not', () => {
    // The flag is checked at the moment of publishing rather than at the
    // moment an admin clicked, so a withdrawal after approval takes effect.
    expect(mayPublish({ ...approved, status: 'PUBLISHED', marketingPermission: false })).toBe(
      false,
    );
  });

  it('treats a missing permission flag as no', () => {
    expect(mayPublish({ testimonialText: 'Great', status: 'APPROVED' })).toBe(false);
  });
});

describe('how a host is credited', () => {
  it('shows nothing at all when they chose anonymous', () => {
    expect(displayNameFor('anonymous', 'Dana Whitfield')).toBe('');
    expect(displayNameFor(null, 'Dana Whitfield')).toBe('');
  });

  it('shows what they picked, and no more', () => {
    expect(displayNameFor('first_name', 'Dana Whitfield')).toBe('Dana');
    expect(displayNameFor('first_initial', 'Dana Whitfield')).toBe('Dana W.');
    expect(displayNameFor('full_name', 'Dana Whitfield')).toBe('Dana Whitfield');
  });

  it('does not invent a surname initial from a single name', () => {
    expect(displayNameFor('first_initial', 'Dana')).toBe('Dana');
  });
});

describe('free text', () => {
  it('strips control characters without a regex full of literal control bytes', () => {
    // Three separate files in this codebase have had literal control bytes
    // embedded into them by a character-class regex. This one scans code
    // points instead.
    expect(cleanText('ok\u0000\u0007fine', 100)).toBe('okfine');
    expect(cleanText('keeps\nnewlines\tand tabs', 100)).toBe('keeps\nnewlines\tand tabs');
  });

  it('bounds what reaches storage', () => {
    expect(cleanText('x'.repeat(5000), 1200)).toHaveLength(1200);
    expect(cleanText(42, 100)).toBe('');
  });
});

describe('the roll-up', () => {
  it('reports no average rather than zero when nobody has answered', () => {
    // "Average rating 0.0" reads as a catastrophe where the truth is that
    // nobody has answered yet. Same choice the monthly report makes.
    const empty = summarize([]);
    expect(empty.average).toBeNull();
    expect(empty.positiveRate).toBeNull();
    expect(empty.responses).toBe(0);
  });

  it('counts scores, low scores and publishable testimonials separately', () => {
    const rows = [
      { rating: 5, testimonialText: 'Loved it', marketingPermission: true, status: 'APPROVED' },
      { rating: 4, testimonialText: 'Good', marketingPermission: false, status: 'NEW' },
      { rating: 2, privateFeedback: 'Nobody uploaded' },
      { rating: 1 },
    ];
    const stats = summarize(rows);
    expect(stats.responses).toBe(4);
    expect(stats.average).toBe(3);
    expect(stats.lowRatings).toBe(2);
    expect(stats.positiveRate).toBe(50);
    expect(stats.testimonials).toBe(2);
    // Only one of the two may actually be shown to anyone.
    expect(stats.publishable).toBe(1);
  });

  it('ignores rows that were requested but never answered', () => {
    expect(summarize([{ rating: null }, { rating: 5 }]).responses).toBe(1);
  });
});

describe('the link', () => {
  it('round-trips', () => {
    const parts = { eventId: 'evt_123', token: 'a'.repeat(48) };
    expect(decodeRatingLink(encodeRatingLink(parts))).toEqual(parts);
  });

  it('returns null for anything malformed, so a bad link and a wrong token look alike', () => {
    expect(decodeRatingLink('')).toBeNull();
    expect(decodeRatingLink('not-base64!!')).toBeNull();
    expect(decodeRatingLink(null)).toBeNull();
    // Three parts is the survey link's shape, not this one's.
    expect(decodeRatingLink(Buffer.from('a|b|c').toString('base64url'))).toBeNull();
  });

  it('refuses lengths that would make a bad key or a slow comparison', () => {
    const long = { eventId: 'x'.repeat(200), token: 'y' };
    expect(decodeRatingLink(encodeRatingLink(long))).toBeNull();
  });

  it('survives an email client, carrying no padding or unsafe characters', () => {
    const encoded = encodeRatingLink({ eventId: 'evt_/+abc', token: 'f'.repeat(48) });
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('the submit function', () => {
  const handler = read('amplify/functions/submit-feedback/handler.ts');

  it('compares the token in constant time', () => {
    expect(handler).toContain('timingSafeEqual');
  });

  it('gives one answer to a bad link, a wrong token and an unknown event', () => {
    // Anything else lets a stranger discover which event ids are real.
    expect(handler).toContain('const REFUSED');
    expect(handler.match(/throw new Error\(REFUSED\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('will only ever fill in a row the job already created', () => {
    // A row that appeared because someone guessed an id would be a row with no
    // proof anyone was sent it.
    expect(handler).toContain("ConditionExpression: 'attribute_exists(id)'");
    expect(handler).not.toContain('PutItemCommand');
  });

  it('lets a score be set once', () => {
    expect(handler).toContain('existingRating === null');
  });

  it('opens a follow-up on a low score', () => {
    expect(handler).toContain("branchFor(incoming) === 'support'");
    expect(handler).toContain('supportFollowUpNeeded');
  });

  it('takes permission from consentFrom rather than the argument', () => {
    expect(handler).toContain('consentFrom(event.arguments.marketingPermission)');
    expect(handler).toContain('consent.granted');
  });
});

describe('the daily job', () => {
  const handler = read('amplify/functions/daily-tasks/handler.ts');

  it('creates the row with its token before anyone rates', () => {
    expect(handler).toContain('openRatingRequest');
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(id)'");
  });

  it('treats the request as optional mail, so an opt-out is absolute', () => {
    expect(handler).toContain("mayReceive(event.alertEmail, 'growth-nudge', preference)");
  });

  it('asks unsuccessful events too', () => {
    // The survey pass filters on isSuccessfulEvent. This one deliberately does
    // not: asking only the hosts whose events worked how the product went
    // would measure the failure rate entirely from events where it did not
    // fail.
    const ratingPass = handler.slice(handler.indexOf('// Rating requests.'));
    expect(ratingPass).not.toContain('isSuccessfulEvent');
  });

  it('sends nothing in a dry run', () => {
    expect(handler).toContain("'[dry-run] would ask for a rating'");
  });
});

describe('the admin queue', () => {
  const admin = read('pages/global-admin.tsx');
  const api = read('lib/api.ts');

  it('cannot approve a testimonial the host did not consent to', () => {
    expect(api).toContain('did not give permission to publish their words');
  });

  it('surfaces unanswered low ratings rather than filing them', () => {
    expect(admin).toContain('supportFollowUpNeeded');
    expect(admin).toContain('A support issue should get support, not marketing.');
  });
});
