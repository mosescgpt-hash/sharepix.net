import { codeOnly, proseOf, readSource } from './sourceGuards';

import {
  COMPARATIVE_PHRASES,
  DIFFERENTIATORS,
  comparativePhrasesIn,
  differentiatorFor,
} from '../lib/differentiators';

/**
 * The homepage's competitive claims, checked against the code that makes them
 * true.
 *
 * This is the only file in the repository where a test failure means *the
 * marketing is now a lie*. Everything else here guards behaviour; this guards
 * a promise somebody bought on.
 *
 * It exists because the alternative has already happened. The README carried a
 * section asserting production state that was wrong within a day of being
 * written, and go-live-prints.md described a sandbox for months after the
 * switch was flipped. Those were internal. A privacy claim on a landing page
 * has a customer behind it.
 */

describe('every claim names code that backs it', () => {
  it.each(DIFFERENTIATORS.map((d) => [d.id, d.backedBy] as const))(
    '%s points at a file that exists',
    (_id, backedBy) => {
      expect(() => readSource(backedBy)).not.toThrow();
    },
  );

  it('gives every claim a badge and a boundary', () => {
    for (const item of DIFFERENTIATORS) {
      expect(item.badge).not.toBe('');
      // A claim with no stated limit is either trivial or overstated. Six
      // claims, six honest edges — the edges are what make the rest credible.
      expect(item.boundary.length).toBeGreaterThan(20);
    }
  });

  it('has no duplicate ids', () => {
    const ids = DIFFERENTIATORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('guests really never authenticate', () => {
  const schema = codeOnly(readSource('amplify/data/resource.ts'));

  it('lets a guest create a photo without signing in', () => {
    // The whole "zero onboarding" claim. If this became authenticated-only,
    // the headline would be false and nothing else would notice.
    expect(schema).toContain('allow.guest()');
  });
});

describe('location really is stripped from photos', () => {
  const exif = readSource('amplify/functions/sanitize-upload/exif.ts');
  const handler = codeOnly(readSource('amplify/functions/sanitize-upload/handler.ts'));

  it('rebuilds the EXIF block rather than blocklisting tags', () => {
    // The claim is "location is removed", not "we try to remove location".
    // Rebuilding from nothing means GPS cannot survive a tag we forgot.
    expect(exif).toContain('export function stripJpegMetadata');
    expect(proseOf(exif)).toContain('gone by construction rather than by blocklist');
  });

  it('clears GPS from HEIC as well, which is what iPhones actually send', () => {
    expect(exif).toContain('export function stripHeicGps');
  });

  it('is wired into the upload path, not merely defined', () => {
    // A stripping function nobody calls is the most plausible way this claim
    // rots: the code still reads correctly and does nothing.
    expect(handler).toContain('await stripMetadata(bucket, key, header, headerObj.Metadata)');
    expect(handler).toContain('stripJpegMetadata(bytes)');
    expect(handler).toContain('stripHeicGps(bytes)');
  });

  it('mirrors the stripped copy to R2, never the guest original', () => {
    // If the unstripped original reached the CDN, the coordinates would be
    // served from it and the claim would be false in the place it matters.
    //
    // The predicate is whether THIS pass rewrote the file, not whether the
    // file is a type that might be rewritten. A video is only rewritten when
    // it actually carries coordinates, so the type-based version left every
    // location-free video out of R2.
    expect(handler).toContain('rewritten: rewrote');
    expect(handler).not.toContain('const strippable =');
  });

  it('strips video too, so the claim holds for everything a phone sends', () => {
    expect(handler).toContain('stripVideoLocation(bucket, key)');
  });

  it('never re-encodes a video to strip it', () => {
    // The original-quality claim and the location claim have to hold at the
    // same time. Handing back a transcode would keep one by breaking the other.
    const video = codeOnly(readSource('amplify/functions/sanitize-upload/video.ts'));
    expect(video).not.toContain('ffmpeg');
    expect(video).not.toContain('transcode');
  });

  it('says what a video keeps, since it is not everything', () => {
    // Photos lose all metadata; a video loses only its coordinates, because
    // removing the rest would mean re-encoding. Claiming parity would be the
    // overstatement this whole file exists to catch.
    const claim = differentiatorFor('location-stripped');
    expect(claim?.boundary.toLowerCase()).toContain('video');
    expect(claim?.boundary.toLowerCase()).toContain('keeps the rest');
  });
});

describe('uploads really are kept at full resolution', () => {
  const handler = codeOnly(readSource('amplify/functions/sanitize-upload/handler.ts'));

  it('never resizes or re-encodes a guest upload', () => {
    // "The original file, not a copy of it" is the claim. Any of these
    // appearing in the upload path would make it false.
    expect(handler).not.toContain('resize');
    expect(handler).not.toContain('quality');
  });
});

describe('screening really is on every plan', () => {
  const photo = codeOnly(readSource('amplify/functions/create-event-photo/handler.ts'));
  const pricing = codeOnly(readSource('lib/pricing.ts'));

  it('screens inside the create path, before the row exists', () => {
    // "never briefly visible" depends on this ordering: screen first, write
    // second. Screening after the write is a window where it is on the wall.
    expect(photo).toContain('DetectModerationLabels');
  });

  it('does not consult the tier before screening', () => {
    // The claim is that screening is not an upsell. A tier check in this
    // function is exactly what would make it one.
    const screening = photo.slice(
      photo.indexOf('DetectModerationLabels') - 2000,
      photo.indexOf('DetectModerationLabels') + 2000,
    );
    expect(screening).not.toContain('tier ===');
    expect(screening).not.toContain("tier !== 'free'");
  });

  it('has a free tier for the claim to be about', () => {
    expect(pricing).toContain("id: 'free'");
  });
});

describe('galleries really are unlisted', () => {
  it('decides indexability from an allowlist, so an unknown route is private', () => {
    // Tested through the function rather than its comment. A blocklist would
    // make the next page somebody adds indexable by default, and the claim is
    // about the photographs on pages nobody has thought about yet.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isIndexable } = require('../lib/seo') as { isIndexable: (r: string) => boolean };
    expect(isIndexable('/event/[eventId]')).toBe(false);
    expect(isIndexable('/share/[shareId]')).toBe(false);
    expect(isIndexable('/some/route/invented/next/year')).toBe(false);
    expect(isIndexable('/pricing')).toBe(true);
  });

  it('also refuses the gallery paths in robots.txt', () => {
    // Belt and braces, and they do different jobs: noindex needs the crawler
    // to fetch the page to read it, robots stops the fetch.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DISALLOWED_PREFIXES } = require('../lib/seo') as {
      DISALLOWED_PREFIXES: readonly string[];
    };
    expect(DISALLOWED_PREFIXES).toContain('/event/');
    expect(DISALLOWED_PREFIXES).toContain('/share/');
  });
});

describe('the event plans really are one-time', () => {
  const pricing = readSource('lib/pricing.ts');

  it('admits in the claim that Corporate is a subscription', () => {
    // The blanket version of this claim — "nothing auto-renews" — is false,
    // because the Corporate plan bills monthly. Saying so is the difference
    // between a differentiator and a complaint to the FTC.
    expect(pricing).toContain('USD per month');
    const claim = differentiatorFor('one-payment');
    expect(claim?.boundary).toContain('Corporate');
  });
});

describe('nothing here is about anybody else', () => {
  /**
   * A product decision, kept by the repository rather than by memory.
   *
   * SharePix is not going to be the company whose homepage is about how the
   * other options are worse. A page written that way tells the reader where to
   * go and look next, and it ages badly the moment a rival fixes the thing.
   */
  const claimText = DIFFERENTIATORS.map(
    (d) => `${d.title} ${d.claim} ${d.boundary} ${d.badge}`,
  )
    .join(' ')
    .toLowerCase();

  it('uses none of the comparative phrases', () => {
    expect(comparativePhrasesIn(claimText)).toEqual([]);
  });

  it('names no competitor', () => {
    for (const rival of ['GuestPix', 'Kululu', 'Tacboard', 'POV']) {
      expect(claimText).not.toContain(rival.toLowerCase());
    }
  });

  it('quotes no statistic it cannot source', () => {
    // A number nobody can check is a lie; one in a sales claim is an
    // actionable one.
    expect(claimText).not.toMatch(/\d+\s?%/);
    expect(claimText).not.toMatch(/\d+\s?mb/);
  });

  it('applies the same rule to the copy the page actually renders', () => {
    // The module is only half of it. A comparative line typed straight into
    // JSX would sail past a check that only reads the data.
    //
    // codeOnly, because the comments in these files discuss the decision and
    // necessarily contain the words it bans.
    expect(comparativePhrasesIn(codeOnly(readSource('pages/index.tsx')))).toEqual([]);
  });
});

describe('the homepage says these things', () => {
  const page = readSource('pages/index.tsx');

  it('renders the claims from the module rather than retyping them', () => {
    // Copy typed into JSX is copy no test can check. The whole mechanism above
    // depends on the page and the module being the same words.
    expect(page).toContain('DIFFERENTIATORS.map');
  });

  it('carries no two-column comparison against anybody', () => {
    const rendered = codeOnly(page);
    expect(rendered).not.toContain('The usual way');
    expect(rendered).not.toContain('With SharePix');
  });

  it('shows each claim next to its boundary', () => {
    // A page that rendered `claim` and dropped `boundary` would be making the
    // unqualified promise this whole file exists to prevent.
    expect(page).toContain('{item.claim}');
    expect(page).toContain('{item.boundary}');
  });

  it('leads on what a guest does not have to do', () => {
    // "Every moment, everyone's perspective" is true of every product in the
    // category and therefore differentiates nothing.
    //
    // codeOnly, not the raw source: the comment above the headline explains
    // what it replaced, and a raw match would find the old words there. That
    // is the exact failure sourceGuards was written for.
    expect(page).toContain('Nothing to install.');
    expect(codeOnly(page)).not.toContain('Every moment.');
  });

  it('puts a real QR code in the try-it band, not a picture of one', () => {
    // The pitch is "scanning just works". A decorative code that does nothing
    // disproves it at the moment somebody tests it, holding the evidence.
    expect(page).toContain('<StyledQrCode');
    expect(page).toContain('${SITE_ORIGIN}/demo/try');
  });

  it('offers a tap for the phone that cannot scan its own screen', () => {
    expect(page).toContain('Or just tap here');
  });

  it('keeps the illustrative stat row off the page', () => {
    // Three invented figures dressed as platform metrics, on a page whose
    // argument is now that our specific claims are checkable.
    expect(page).not.toContain('Photos shared');
    expect(page).not.toContain('figure="847"');
  });
});

/**
 * The help articles make the same promises the homepage does, to the same
 * customers, and until now nothing checked them.
 *
 * Two were wrong when this was written. `photo-location-data` told guests
 * "every upload here has that location data removed" while video carried its
 * coordinates untouched — a privacy guarantee somebody read and relied on.
 * `guest-download` promised "the same file the photographer's phone produced",
 * which contradicts the deliberate rule that a professional's originals are
 * never served to guests.
 *
 * Neither was caught by the homepage guards, because the homepage is not where
 * they were written.
 */
describe('the help articles agree with the product', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { HELP_ARTICLES } = require('../lib/help') as {
    HELP_ARTICLES: Array<{
      slug: string;
      summary: string;
      blocks: Array<{ kind: string; text?: string }>;
    }>;
  };

  const articleText = (slug: string) => {
    const article = HELP_ARTICLES.find((item) => item.slug === slug);
    if (!article) throw new Error(`No help article "${slug}"`);
    return [article.summary, ...article.blocks.map((block) => block.text ?? '')].join(' ');
  };

  const allText = HELP_ARTICLES.map((article) => articleText(article.slug)).join(' ');

  it('covers video where it claims location is removed', () => {
    // The claim is now true for video. Before it was true only for photos,
    // and said "every upload".
    const text = articleText('photo-location-data').toLowerCase();
    expect(text).toContain('video');
  });

  it('says what each format keeps, rather than implying parity', () => {
    // A JPEG loses everything; HEIC and video lose only the coordinates. A
    // guest deciding whether to upload deserves the real answer.
    const text = articleText('photo-location-data').toLowerCase();
    expect(text).toContain('jpeg');
    expect(text).toContain('heic');
  });

  it('does not promise a professional photographer’s original to guests', () => {
    // professionalMedia.ts has no access rule that reaches it and no code path
    // that mints a URL for it. A help article promising it is a contradiction
    // the product cannot honour.
    const text = articleText('guest-download');
    expect(text).not.toContain('the same file the photographer');
    expect(text.toLowerCase()).toContain('sharepix pro');
    expect(text.toLowerCase()).toContain('reduced-resolution previews');
  });

  it('never tells a guest their video is screened', () => {
    // It is not. Rekognition covers stills only, and a guest who believed
    // otherwise would be relying on something that does not exist.
    expect(allText.toLowerCase()).not.toContain('every video is checked');
    expect(allText.toLowerCase()).not.toContain('videos are screened');
  });

  it('carries no comparative or disparaging framing', () => {
    // The same rule as the homepage, applied where the words actually are.
    // Word boundaries, not substrings: "rivals" is inside "arrivals", and the
    // slideshow copy says "new arrivals jump the queue".
    expect(comparativePhrasesIn(allText)).toEqual([]);
  });
});

describe('every customer-facing page follows the no-bashing rule', () => {
  // The homepage guard only ever read the homepage. These are the other pages
  // a prospect actually lands on.
  const PAGES = [
    'pages/index.tsx',
    'pages/pricing.tsx',
    'pages/join.tsx',
    'pages/fair-use.tsx',
    'pages/demo/index.tsx',
    'pages/demo/gallery.tsx',
    'pages/demo/try.tsx',
    'pages/demo/try-upload.tsx',
  ];

  it.each(PAGES)('%s says nothing about anybody else', (path) => {
    // codeOnly, because these files discuss the decision in their comments and
    // necessarily contain the words it bans.
    expect(comparativePhrasesIn(codeOnly(readSource(path)))).toEqual([]);
  });
});

describe('the phrase check itself', () => {
  it('matches whole words, not fragments of innocent ones', () => {
    // The bug this replaced: a substring test on "rivals" fired on the live
    // slideshow copy, "new arrivals jump the queue". A guard that cries wolf
    // on ordinary prose is a guard somebody switches off.
    expect(comparativePhrasesIn('new arrivals jump the queue')).toEqual([]);
    // "unlikely" is not "unlike", and this is why the match allows a plural
    // and nothing else.
    expect(comparativePhrasesIn('an unlikely outcome')).toEqual([]);
  });

  it('catches a plural, which the obvious spelling misses', () => {
    // A trailing \b cannot sit between "competitor" and its own plural, so a
    // both-ends boundary has a hole exactly where the word usually appears.
    // An earlier version of this test asserted that hole as correct.
    expect(comparativePhrasesIn('our competitors are worse')).toContain('competitor');
  });

  it('still catches the real thing', () => {
    expect(comparativePhrasesIn('Unlike the other apps, we do not')).toEqual(
      expect.arrayContaining(['unlike', 'other apps']),
    );
    expect(comparativePhrasesIn('no sneaky fees here')).toContain('sneaky');
  });

  it('keeps every listed phrase reachable', () => {
    // A phrase nothing can ever match is a rule that is not being kept.
    for (const phrase of COMPARATIVE_PHRASES) {
      expect(comparativePhrasesIn(`before ${phrase} after`)).toContain(phrase);
    }
  });
});
