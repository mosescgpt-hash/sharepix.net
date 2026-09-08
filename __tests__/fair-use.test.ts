import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ABUSE_MARGIN,
  BREAK_EVEN_STORAGE_GB,
  FAIR_USE_DEFAULTS,
  FAIR_USE_NOTICE,
  UNIT_ECONOMICS,
  assessUsage,
  fairUseConfig,
  formatBytes,
  totalBytes,
  windowExpired,
} from '../lib/fairUse';
import {
  counterForKind,
  eventIdForKey,
  kindForKey,
  usableSize,
} from '../lib/mediaAccounting';
import { codeOnly } from './sourceGuards';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

const GB = 1024 * 1024 * 1024;

describe('the copies have not drifted', () => {
  it('keeps create-event-photo/fairUse.ts byte-identical with lib/', () => {
    expect(bodyOf(read('amplify/functions/create-event-photo/fairUse.ts'))).toBe(
      bodyOf(read('lib/fairUse.ts')),
    );
  });

  it.each(['sanitize-upload', 'delete-event-photo'])(
    'keeps %s/accounting.ts byte-identical with lib/mediaAccounting.ts',
    (fn) => {
      expect(bodyOf(read(`amplify/functions/${fn}/accounting.ts`))).toBe(
        bodyOf(read('lib/mediaAccounting.ts')),
      );
    },
  );
});

describe('what a threshold does', () => {
  it('leaves an ordinary event alone', () => {
    const assessment = assessUsage({ photoCount: 400, photoBytes: 2 * GB });
    expect(assessment.status).toBe('NORMAL');
    expect(assessment.blocked).toBe(false);
  });

  it('does not block a big real event, only flags it', () => {
    // A 300-guest wedding legitimately producing thousands of photos must
    // upload exactly as freely as a small one. Throttling a paying customer
    // whose event went well is the expensive mistake here.
    const assessment = assessUsage({
      photoCount: FAIR_USE_DEFAULTS.photoReviewThreshold + 1,
      photoBytes: 3 * GB,
    });
    expect(assessment.blocked).toBe(false);
    expect(assessment.status).toBe('HIGH_USAGE');
  });

  it('escalates to REVIEW only when more than one threshold is crossed', () => {
    // One threshold alone is usually just a big event. Two at once is the
    // shape abuse actually has.
    const assessment = assessUsage({
      photoCount: FAIR_USE_DEFAULTS.photoReviewThreshold + 1,
      photoBytes: FAIR_USE_DEFAULTS.storageReviewBytes + 1,
    });
    expect(assessment.status).toBe('REVIEW');
    expect(assessment.blocked).toBe(false);
  });

  it('blocks only at the abuse thresholds', () => {
    expect(assessUsage({ photoCount: FAIR_USE_DEFAULTS.photoAbuseThreshold }).blocked).toBe(
      true,
    );
    expect(
      assessUsage({ photoBytes: FAIR_USE_DEFAULTS.storageAbuseBytes }).blocked,
    ).toBe(true);
    expect(
      assessUsage({ windowCount: FAIR_USE_DEFAULTS.velocityAbusePerMinute }).blocked,
    ).toBe(true);
  });

  /**
   * The largest event we are willing to call plausible.
   *
   * The doc comment reasons a 300-guest wedding to about 2,000 photos. This is
   * five times that, so an abuse threshold above it cannot be reached by any
   * real celebration.
   */
  const LARGEST_PLAUSIBLE_EVENT_PHOTOS = 10_000;

  it('puts the abuse thresholds above any plausible event', () => {
    // If these ever drift down to where a real wedding reaches them, the
    // product has quietly stopped meaning "unlimited".
    expect(FAIR_USE_DEFAULTS.photoAbuseThreshold).toBeGreaterThan(
      LARGEST_PLAUSIBLE_EVENT_PHOTOS,
    );
    expect(FAIR_USE_DEFAULTS.storageAbuseBytes).toBeGreaterThanOrEqual(100 * GB);
    expect(FAIR_USE_DEFAULTS.photoAbuseThreshold).toBeGreaterThan(
      FAIR_USE_DEFAULTS.photoReviewThreshold * 5,
    );
  });

  it('puts them BELOW the point where the event stops paying for itself', () => {
    // The half that was missing, and it cost real money. The old threshold sat
    // at 2.6x break-even purely because 50,000 sounded like a lot, so an event
    // could lose upward of a hundred dollars before anything stopped it.
    //
    // This assertion is the one that matters, because it is the only one that
    // fails when the price changes and nobody revisits these numbers.
    const abuseGb = FAIR_USE_DEFAULTS.storageAbuseBytes / GB;
    expect(abuseGb).toBeLessThan(BREAK_EVEN_STORAGE_GB);
    expect(ABUSE_MARGIN).toBeLessThan(1);
  });

  it('still turns a profit at the moment it blocks', () => {
    // Stated as money rather than as a ratio, because a ratio is easy to
    // satisfy and easy to misread.
    const abuseGb = FAIR_USE_DEFAULTS.storageAbuseBytes / GB;
    const cost = abuseGb * UNIT_ECONOMICS.costPerGbUsd + UNIT_ECONOMICS.fixedCostUsd;
    expect(UNIT_ECONOMICS.netRevenueUsd - cost).toBeGreaterThan(0);
  });

  it('leaves a usable window between "plausible" and "unprofitable"', () => {
    // If these two ever cross, no threshold can be both safe for customers and
    // safe for the business, and the answer is a pricing change rather than a
    // threshold change. Better to fail here than to pick a side quietly.
    const plausibleGb = (LARGEST_PLAUSIBLE_EVENT_PHOTOS * 4.05) / 1024;
    expect(plausibleGb).toBeLessThan(BREAK_EVEN_STORAGE_GB);
  });

  it('keeps the photo count consistent with the byte threshold', () => {
    // They are two views of the same limit. If the count could be reached
    // while the byte threshold still had room, the tighter one would be doing
    // all the work and the other would be decoration.
    const impliedGb = (FAIR_USE_DEFAULTS.photoAbuseThreshold * 4.05) / 1024;
    const abuseGb = FAIR_USE_DEFAULTS.storageAbuseBytes / GB;
    expect(Math.abs(impliedGb - abuseGb) / abuseGb).toBeLessThan(0.05);
  });

  it('sets video thresholds a real event can actually reach', () => {
    // Both were dead config: the plan allows 30 videos at 250 MB, so an event
    // cannot exceed 7.5 GB of video, and the thresholds were 20 GB and 200 GB.
    const maxVideoGb = (30 * 250) / 1024;
    expect(FAIR_USE_DEFAULTS.videoStorageReviewBytes / GB).toBeLessThan(maxVideoGb);
    // Abuse stays above the plan ceiling, because reaching it means an admin
    // granted extra credits — which is a decision, not abuse.
    expect(FAIR_USE_DEFAULTS.videoStorageAbuseBytes / GB).toBeGreaterThan(maxVideoGb);
  });

  it('counts video against its own ceiling as well as the total', () => {
    // Video is the expensive half and the half not bounded by resizing, so a
    // thousand photos must not mask it.
    const assessment = assessUsage({ videoBytes: FAIR_USE_DEFAULTS.videoStorageAbuseBytes });
    expect(assessment.blocked).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/video/);
  });
});

describe("an admin's judgement", () => {
  it('clears an event the thresholds flagged', () => {
    const flagged = {
      photoCount: FAIR_USE_DEFAULTS.photoReviewThreshold + 1,
      photoBytes: FAIR_USE_DEFAULTS.storageReviewBytes + 1,
    };
    expect(assessUsage(flagged).status).toBe('REVIEW');
    // A person who looked and judged it fine must be able to say so without
    // the thresholds arguing back every hour.
    expect(assessUsage({ ...flagged, manualStatus: 'NORMAL' }).status).toBe('NORMAL');
    expect(assessUsage({ ...flagged, manualStatus: 'NORMAL' }).blocked).toBe(false);
  });

  it('restricts an event the thresholds did not', () => {
    const assessment = assessUsage({ photoCount: 10, manualStatus: 'RESTRICTED' });
    expect(assessment.blocked).toBe(true);
    expect(assessment.reasons.join(' ')).toMatch(/admin/i);
  });
});

describe('configuration', () => {
  it('reads overrides from the environment', () => {
    const config = fairUseConfig({ FAIR_USE_PHOTO_REVIEW: '10' });
    expect(config.photoReviewThreshold).toBe(10);
    expect(config.photoAbuseThreshold).toBe(FAIR_USE_DEFAULTS.photoAbuseThreshold);
  });

  it('ignores a broken override rather than applying it', () => {
    // A bad env var must not be able to set every threshold to zero and block
    // every upload in the product.
    for (const bad of ['', 'nonsense', '-5', '0', undefined]) {
      expect(fairUseConfig({ FAIR_USE_PHOTO_ABUSE: bad }).photoAbuseThreshold).toBe(
        FAIR_USE_DEFAULTS.photoAbuseThreshold,
      );
    }
  });
});

describe('the velocity window', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  it('treats a missing or unparseable start as expired', () => {
    expect(windowExpired(null, now)).toBe(true);
    expect(windowExpired('not a date', now)).toBe(true);
  });

  it('expires after the configured window', () => {
    expect(windowExpired('2026-09-07T11:59:30.000Z', now)).toBe(false);
    expect(windowExpired('2026-09-07T11:59:00.000Z', now)).toBe(true);
  });
});

describe('byte accounting', () => {
  it('sorts a key into the counter it belongs to', () => {
    expect(kindForKey('events/e1/photos/abc-pic.jpg')).toBe('photo');
    expect(kindForKey('events/e1/photos/abc-clip.mp4')).toBe('video');
    expect(kindForKey('events/e1/previews/abc-preview.jpg')).toBe('derived');
    expect(kindForKey('events/e1/thumbs/abc-thumb.jpg')).toBe('derived');
    // Not ours: counted nowhere rather than counted wrongly.
    expect(kindForKey('uploads/whatever.jpg')).toBeNull();
  });

  it('separates what we generate from what the guest sent', () => {
    // Folding previews and thumbs into the photo total would make an event's
    // storage read about a third larger than what anyone actually uploaded.
    expect(counterForKind('photo')).toBe('photoBytes');
    expect(counterForKind('video')).toBe('videoBytes');
    expect(counterForKind('derived')).toBe('derivedBytes');
  });

  it('finds the event in a key, and nothing in one that is not ours', () => {
    expect(eventIdForKey('events/evt_42/photos/x.jpg')).toBe('evt_42');
    expect(eventIdForKey('nonsense')).toBe('');
  });

  it('refuses a size that would corrupt a counter', () => {
    // A NaN reaching a DynamoDB ADD corrupts the counter permanently.
    expect(usableSize(NaN)).toBeNull();
    expect(usableSize(Infinity)).toBeNull();
    expect(usableSize(-1)).toBeNull();
    expect(usableSize(0)).toBeNull();
    expect(usableSize('nonsense')).toBeNull();
    expect(usableSize(1024)).toBe(1024);
  });

  it('adds the three counters up, ignoring negatives', () => {
    expect(totalBytes({ photoBytes: 100, videoBytes: 50, derivedBytes: 25 })).toBe(175);
    expect(totalBytes({ photoBytes: -100, videoBytes: 50 })).toBe(50);
    expect(totalBytes(null)).toBe(0);
  });

  it('formats bytes for a person', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2.5 * GB)).toBe('2.50 GB');
    expect(formatBytes(null)).toBe('0 B');
  });
});

describe('the counters are not a 32-bit integer', () => {
  it('stores bytes as Float in the schema', () => {
    // GraphQL Int is 32-bit signed, so it tops out at 2.1 GB. A single event
    // with a few hundred videos passes that and the overflow is silent.
    const schema = read('amplify/data/resource.ts');
    for (const field of ['photoBytes', 'videoBytes', 'derivedBytes']) {
      expect(schema).toContain(`${field}: a.float()`);
    }
    expect(schema).toContain('bytes: a.float()');
  });
});

describe('the accounting is idempotent', () => {
  const handler = read('amplify/functions/sanitize-upload/handler.ts');

  it('gates the increment on a conditional put', () => {
    // S3 delivers at-least-once, and a strippable original arrives twice by
    // design. The counter must move only when the ledger row is genuinely new.
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(id)'");
    expect(handler).toContain('recordBytes');
  });

  it('measures the size server-side, never from the client', () => {
    // Uploads go browser to S3 directly, so the only true size is the one in
    // the S3 event. A counter the client could set to zero would be worse than
    // no counter, because it would read as authoritative.
    expect(handler).toContain('record?.s3?.object?.size');
    const createPhoto = read('amplify/functions/create-event-photo/handler.ts');
    expect(createPhoto).not.toContain('arguments.sizeBytes');
  });
});

describe('deleting a photo actually deletes it', () => {
  const handler = read('amplify/functions/delete-event-photo/handler.ts');

  it('removes the copy R2 serves, not only the one in S3', () => {
    // mediaUrls signs a key without consulting the photo table, so before this
    // anyone already holding a deleted photo's key kept a working URL forever.
    expect(handler).toContain('r2KeyFor');
    expect(handler).toContain('R2_BUCKET');
  });

  it('removes the thumbnail too', () => {
    // It was left behind entirely, in both stores.
    expect(handler).toContain('item.thumbS3Key?.S');
  });

  it('gives back exactly the bytes that were counted', () => {
    expect(handler).toContain('releaseBytes');
    // Read from the ledger rather than re-measured, and floored so a double
    // release cannot drive a counter negative.
    expect(handler).toContain('MEDIA_TABLE');
    expect(handler).toMatch(/>= :bytes/);
  });
});

describe('what the customer is told', () => {
  it('says what fair use means without listing a threshold', () => {
    // A notice that lists numbers makes a normal customer count their photos,
    // which is exactly the anxiety "unlimited" is meant to remove.
    expect(FAIR_USE_NOTICE).toMatch(/normal event use/i);
    expect(FAIR_USE_NOTICE).not.toMatch(/\d{3,}/);
  });
});

describe('what the pricing page claims', () => {
  const cards = read('components/PricingCards.tsx');
  const pricing = read('pages/pricing.tsx');
  const home = read('pages/index.tsx');
  // Absence checks read code, never prose — see __tests__/sourceGuards.ts.
  const strip = codeOnly;

  it('claims unlimited photos, and carries the asterisk', () => {
    expect(cards).toContain('Unlimited photo uploads*');
    // An asterisk with nothing behind it is worse than no asterisk. This one
    // renders FAIR_USE_NOTICE directly rather than restating it, so the two
    // cannot drift.
    expect(cards).toContain('FAIR_USE_NOTICE');
  });

  it('does not claim unlimited video anywhere a customer reads', () => {
    // Video is the one upload whose cost is not bounded by resizing, and the
    // allowance must not be set before real usage data exists.
    for (const source of [cards, pricing, home]) {
      expect(source.toLowerCase()).not.toContain('unlimited video');
    }
  });

  it('does not advertise features SharePix does not have', () => {
    // Three items on the pricing brief's list do not exist in the product:
    // per-event password/PIN protection, co-host access, and photo challenges.
    // Listing them would be a claim discovered by a customer rather than by us.
    //
    // Password is deliberately NOT checked as a forbidden substring: the FAQ
    // legitimately says the gallery is "not password-protected", and a
    // substring cannot tell a denial from a claim. The honest statement is
    // asserted positively in the test below instead.
    const claims = `${strip(cards)} ${strip(pricing)}`.toLowerCase();
    for (const absent of ['co-host', 'cohost', 'photo challenge', 'missions']) {
      expect(claims).not.toContain(absent);
    }
  });

  it('calls the gallery unlisted rather than private-with-a-password', () => {
    // "Private" invites the assumption of a password. The gallery is unlisted,
    // which is a real and different promise, and the FAQ says so plainly.
    expect(pricing).toContain('It is unlisted');
    expect(pricing).toContain('not password-protected');
  });

  it('uses no discount theatre', () => {
    // No strikethrough, no "was", no countdown. A single confident price does
    // not need decoration and decoration would undercut it.
    const copy = `${strip(cards)} ${strip(pricing)}`.toLowerCase();
    for (const trick of ['line-through', 'normally $', 'was $', 'countdown', 'limited time']) {
      expect(copy).not.toContain(trick);
    }
  });

  it('tells the customer the media is eventually deleted', () => {
    // Retention is what funds the unlimited promise, so it has to be stated
    // rather than discovered.
    expect(pricing).toContain('archived for 90 days and then permanently deleted');
  });
});

describe('the fair-use policy exists as a policy', () => {
  const terms = read('pages/terms.tsx');
  const cards = read('components/PricingCards.tsx');

  it('has a section in the terms, not only a sentence on the pricing page', () => {
    // The pricing page cites "SharePix's fair-use policy". For a while there
    // was no such policy — the asterisk pointed at its own footnote. That is
    // the thing the footnote itself warns against.
    expect(terms).toContain('id="fair-use"');
    expect(terms).toContain('Fair use of unlimited uploads');
    expect(terms).toContain('FAIR_USE_NOTICE');
  });

  it('links the asterisk to it', () => {
    expect(cards).toContain('/terms#fair-use');
  });

  it('promises not to punish an event for being popular', () => {
    // The whole point of removing the cap. A fair-use section that reads as a
    // threat undoes the thing it is attached to.
    expect(terms).toMatch(/will not restrict an event\s+simply because it was popular/);
  });

  it('names the right legal entity in the liability clause', () => {
    // It said CALVIN SOLUTIONS LLC — an entity that is not the one operating
    // the service, in the single most consequential sentence in the document.
    expect(terms).not.toContain('CALVIN SOLUTIONS');
    expect(terms).toContain('{LEGAL_ENTITY.toUpperCase()}');
  });

  it('numbers its sections once each', () => {
    // Inserting a section renumbers everything after it, and a document with
    // two section 8s is a document somebody cites wrongly.
    const numbers = [...terms.matchAll(/<h2[^>]*>(\d+)\./g)].map((m) => Number(m[1]));
    expect(numbers).toEqual([...Array(numbers.length)].map((_, i) => i + 1));
  });
});
