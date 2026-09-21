import { codeOnly, proseOf, readSource } from './sourceGuards';

import { COMPARISONS, DIFFERENTIATORS, differentiatorFor } from '../lib/differentiators';

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
    expect(handler).toContain('const strippable = isJpeg(header) || isHeic(header);');
  });

  it('says on the page that video is not covered', () => {
    // The claim's boundary, and the one that could hurt somebody. The handler
    // returns early for anything that is not JPEG or HEIC.
    expect(handler).toContain('if (!jpeg && !isHeic(header)) return;');
    const claim = differentiatorFor('location-stripped');
    expect(claim?.boundary.toLowerCase()).toContain('video');
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

describe('the comparison table', () => {
  it('ties every row to a claim that is checked above', () => {
    for (const row of COMPARISONS) {
      expect(differentiatorFor(row.differentiatorId)).toBeDefined();
    }
  });

  it('names no competitor and quotes no invented statistic', () => {
    // Two reasons, in order of how much they matter: a number nobody can
    // source is a lie, and a claim about a named rival has to be defensible.
    const text = COMPARISONS.map((row) => `${row.usual} ${row.sharepix}`).join(' ');
    expect(text).not.toMatch(/\d+\s?%/);
    expect(text).not.toMatch(/\d+\s?MB/i);
    for (const rival of ['GuestPix', 'Kululu', 'Tacboard', 'POV', 'Dropbox', 'Google Drive']) {
      expect(text).not.toContain(rival);
    }
  });
});

describe('the homepage says these things', () => {
  const page = readSource('pages/index.tsx');

  it('renders the claims from the module rather than retyping them', () => {
    // Copy typed into JSX is copy no test can check. The whole mechanism above
    // depends on the page and the module being the same words.
    expect(page).toContain('DIFFERENTIATORS.map');
    expect(page).toContain('COMPARISONS.map');
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
