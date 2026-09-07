import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FAIR_USE_DEFAULTS,
  FAIR_USE_NOTICE,
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

  it('puts the abuse thresholds far above any plausible event', () => {
    // If these ever drift down to where a real wedding reaches them, the
    // product has quietly stopped meaning "unlimited".
    expect(FAIR_USE_DEFAULTS.photoAbuseThreshold).toBeGreaterThanOrEqual(50_000);
    expect(FAIR_USE_DEFAULTS.storageAbuseBytes).toBeGreaterThanOrEqual(100 * GB);
    expect(FAIR_USE_DEFAULTS.photoAbuseThreshold).toBeGreaterThan(
      FAIR_USE_DEFAULTS.photoReviewThreshold * 5,
    );
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
