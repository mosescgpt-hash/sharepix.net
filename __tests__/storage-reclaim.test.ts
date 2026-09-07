import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ARCHIVE_DAYS as RECLAIM_ARCHIVE_DAYS,
  COMPANION_TABLES,
  GRACE_DAYS,
  daysUntilReclaim,
  lifespanDays,
  reclaimSummary,
  reclaimVerdict,
  storedKeysOf,
} from '../lib/storageReclaim';
import { ARCHIVE_DAYS, getTier } from '../lib/pricing';
import { codeOnly } from './sourceGuards';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const bodyOf = (source: string) => source.slice(source.indexOf('*/') + 2).trim();

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2028-06-01T12:00:00.000Z');
/** An upload window that closed `days` ago. */
const closedDaysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const PAID_RETENTION = getTier('plus')?.retentionDays ?? 365;

describe('the copies have not drifted', () => {
  it('keeps reclaim-storage/storageReclaim.ts byte-identical with lib/', () => {
    expect(bodyOf(read('amplify/functions/reclaim-storage/storageReclaim.ts'))).toBe(
      bodyOf(read('lib/storageReclaim.ts')),
    );
  });

  it('keeps the archive window equal to the one in pricing', () => {
    // A value in storageReclaim that is SMALLER than pricing's deletes inside a
    // window the host was told they could still recover from. Larger only
    // delays deletion, which costs storage and nothing else.
    expect(RECLAIM_ARCHIVE_DAYS).toBe(ARCHIVE_DAYS);
  });

  it('keeps the function copy of the retention table equal to the tiers', () => {
    // The Lambda cannot import lib/pricing, so the table is duplicated. A value
    // too small here is the dangerous direction.
    const handler = read('amplify/functions/reclaim-storage/handler.ts');
    for (const tier of ['free', 'plus', 'starter', 'standard', 'premium']) {
      const days = getTier(tier)?.retentionDays;
      expect(days).toBeDefined();
      expect(handler).toMatch(new RegExp(`${tier}:\\s*${days},`));
    }
  });
});

describe('what is never deleted', () => {
  it('refuses an event with no upload window date, however old', () => {
    // A missing date is missing information, not an old event. Guessing an
    // anchor for a destructive action is how you delete a wedding that has not
    // happened yet.
    const verdict = reclaimVerdict({ id: 'e1', tier: 'plus' }, PAID_RETENTION, NOW);
    expect(verdict.reclaim).toBe(false);
    expect(verdict.reason).toBe('no-window-date');
    expect(verdict.deleteAfter).toBeNull();
  });

  it('refuses an unparseable date the same way', () => {
    const verdict = reclaimVerdict(
      { id: 'e1', tier: 'plus', uploadWindowEndsAt: 'last Tuesday' },
      PAID_RETENTION,
      NOW,
    );
    expect(verdict.reclaim).toBe(false);
    expect(verdict.reason).toBe('unparseable-date');
  });

  it('refuses an event whose media is already gone', () => {
    const verdict = reclaimVerdict(
      {
        id: 'e1',
        tier: 'plus',
        uploadWindowEndsAt: closedDaysAgo(9999),
        mediaReclaimedAt: '2028-01-01T00:00:00.000Z',
      },
      PAID_RETENTION,
      NOW,
    );
    expect(verdict.reclaim).toBe(false);
    expect(verdict.reason).toBe('already-reclaimed');
  });

  it('refuses a missing event rather than treating it as due', () => {
    expect(reclaimVerdict(null, PAID_RETENTION, NOW).reclaim).toBe(false);
    expect(reclaimVerdict(undefined, PAID_RETENTION, NOW).reclaim).toBe(false);
  });

  it('falls back to the longest safe retention when the number is broken', () => {
    // A tier lookup that failed must not produce a deletion date in the past
    // for every event at once.
    expect(lifespanDays(NaN)).toBe(90 + ARCHIVE_DAYS + GRACE_DAYS);
    expect(lifespanDays(-1)).toBe(90 + ARCHIVE_DAYS + GRACE_DAYS);
    expect(lifespanDays(0)).toBe(90 + ARCHIVE_DAYS + GRACE_DAYS);
  });
});

describe('when an event does become due', () => {
  const paidLifespan = PAID_RETENTION + ARCHIVE_DAYS + GRACE_DAYS;

  it('waits the gallery, the archive and the grace margin', () => {
    // 12 months + 90 days + 7. One day short is not due.
    const notYet = reclaimVerdict(
      { id: 'e1', tier: 'plus', uploadWindowEndsAt: closedDaysAgo(paidLifespan - 1) },
      PAID_RETENTION,
      NOW,
    );
    expect(notYet.reclaim).toBe(false);
    expect(notYet.reason).toBe('not-yet');

    const due = reclaimVerdict(
      { id: 'e1', tier: 'plus', uploadWindowEndsAt: closedDaysAgo(paidLifespan + 1) },
      PAID_RETENTION,
      NOW,
    );
    expect(due.reclaim).toBe(true);
  });

  it('is still not due at the archive boundary itself', () => {
    // The grace margin exists because an extension bought on the last day has
    // to reach the row before a scheduled job reads it.
    const atBoundary = reclaimVerdict(
      { id: 'e1', tier: 'plus', uploadWindowEndsAt: closedDaysAgo(PAID_RETENTION + ARCHIVE_DAYS) },
      PAID_RETENTION,
      NOW,
    );
    expect(atBoundary.reclaim).toBe(false);
    expect(GRACE_DAYS).toBeGreaterThan(0);
  });

  it('gives a free event a shorter life than a paid one', () => {
    const freeRetention = getTier('free')?.retentionDays ?? 30;
    expect(lifespanDays(freeRetention)).toBeLessThan(lifespanDays(PAID_RETENTION));
  });

  it('reports how long is left, for the admin screen', () => {
    const days = daysUntilReclaim(
      { id: 'e1', tier: 'plus', uploadWindowEndsAt: closedDaysAgo(paidLifespan - 10) },
      PAID_RETENTION,
      NOW,
    );
    expect(days).toBe(10);
    // Nothing to say about an event with no date.
    expect(daysUntilReclaim({ id: 'e1', tier: 'plus' }, PAID_RETENTION, NOW)).toBeNull();
  });
});

describe('which objects go', () => {
  it('takes the original, the preview and the thumbnail', () => {
    expect(
      storedKeysOf({
        s3Key: 'events/e1/photos/a.jpg',
        previewS3Key: 'events/e1/previews/a-preview.jpg',
        thumbS3Key: 'events/e1/thumbs/a-thumb.jpg',
      }),
    ).toHaveLength(3);
  });

  it('drops blank and missing keys rather than deleting against them', () => {
    expect(storedKeysOf({ s3Key: 'events/e1/photos/a.jpg', previewS3Key: '   ' })).toEqual([
      'events/e1/photos/a.jpg',
    ]);
    expect(storedKeysOf({})).toEqual([]);
  });
});

describe('what the operator is told', () => {
  const outcome = {
    eventsConsidered: 200,
    eventsReclaimed: 3,
    photosDeleted: 412,
    objectsDeleted: 1236,
    recordsDeleted: 87,
    bytesFreed: 5 * 1024 * 1024 * 1024,
    skipped: [],
    dryRun: false,
  };

  it('leads with whether anything was actually deleted', () => {
    expect(reclaimSummary({ ...outcome, dryRun: true })).toMatch(/^Nothing was deleted/);
    expect(reclaimSummary(outcome)).toMatch(/^Deleted 412 photos/);
  });

  it('names what guests wrote separately from what they uploaded', () => {
    // "412 photos and 87 guest records" and "499 things" are not the same
    // sentence, and an operator about to switch this on should read the first.
    expect(reclaimSummary(outcome)).toContain('87 guest records');
    expect(reclaimSummary({ ...outcome, dryRun: true })).toContain('87 guest records');
    expect(reclaimSummary({ ...outcome, recordsDeleted: 1 })).toContain('1 guest record from');
  });

  it('counts the skips by reason rather than listing every id', () => {
    const summary = reclaimSummary({
      ...outcome,
      skipped: [
        { eventId: 'a', reason: 'no-window-date' },
        { eventId: 'b', reason: 'no-window-date' },
        { eventId: 'c', reason: 'partial-failure' },
      ],
    });
    expect(summary).toContain('2 no-window-date');
    expect(summary).toContain('1 partial-failure');
  });
});

describe('the job itself', () => {
  const handler = read('amplify/functions/reclaim-storage/handler.ts');
  // Absence checks read code, never prose — see __tests__/sourceGuards.ts.
  const handlerCode = codeOnly(handler);
  const resource = read('amplify/functions/reclaim-storage/resource.ts');
  const backend = read('amplify/backend.ts');

  it('deletes nothing unless explicitly switched on', () => {
    // The same posture as EMAIL_SENDING_ENABLED, for a stronger reason: that
    // one gates an unwanted email, this gates destroying photographs.
    expect(handler).toContain(
      "const RECLAIM_ENABLED = (process.env.STORAGE_RECLAIM_ENABLED ?? '').toLowerCase() === 'true'",
    );
    expect(handler).toContain('[dry-run] would reclaim event media');
    expect(backend).toContain("process.env.STORAGE_RECLAIM_ENABLED ?? ''");
  });

  it('has its own switch, separate from the email one', () => {
    // A single flag over both would eventually be flipped for the wrong reason.
    expect(handlerCode).not.toContain('EMAIL_SENDING_ENABLED');
  });

  it('does not mark anything reclaimed during a dry run', () => {
    // Otherwise switching it on later would skip the backlog as already done.
    const dryRunBlock = handlerCode.slice(
      handlerCode.indexOf('if (!RECLAIM_ENABLED) {'),
      handlerCode.indexOf('let failed = false;'),
    );
    expect(dryRunBlock.length).toBeGreaterThan(0);
    expect(dryRunBlock).not.toContain('mediaReclaimedAt');
    expect(dryRunBlock).not.toContain('DeleteObjectCommand');
  });

  it('bounds how much one run can destroy', () => {
    // The difference between being wrong about twenty-five events and about
    // every event in the table is the difference between an incident and the
    // end of the product.
    expect(handler).toMatch(/MAX_EVENTS_PER_RUN = \d+/);
    expect(handler).toContain('due.slice(0, MAX_EVENTS_PER_RUN)');
  });

  it('deletes from R2 as well as S3', () => {
    // R2 serves the reads. A copy left there is a photo that is still
    // reachable by anyone holding the key.
    expect(handler).toContain('r2KeyFor');
    expect(handler).toContain('R2_BUCKET');
  });

  it('leaves the mark unset when a delete partly failed', () => {
    // Marking it done while records survive would strand them forever.
    expect(handler).toContain("reason: 'partial-failure'");
  });

  it('zeroes the byte counters when it marks an event reclaimed', () => {
    // An event whose media is gone but whose counters read 4 GB would sit at
    // the top of the storage list forever.
    expect(handler).toContain('photoBytes = :zero');
  });

  it('runs on its own schedule, not inside the daily job', () => {
    // The daily job must never stop warning hosts that their gallery is
    // closing, and a job that deletes photos must never be the reason it did.
    expect(resource).toContain("schedule: 'every week'");
    expect(read('amplify/functions/daily-tasks/handler.ts')).not.toContain('reclaim');
  });

  it('deletes what guests wrote, not only what they uploaded', () => {
    // The gap this closes: reclamation destroyed an event's photos at the end
    // of the archive window and left every comment, reaction, guest book entry
    // and moment in the database. Free text people wrote at a wedding or a
    // memorial, outliving the photographs it was written under.
    for (const table of COMPANION_TABLES) {
      expect(handler).toContain(`label: '${table}'`);
    }
    expect(handler).toContain('async function rowsByEvent');
    expect(handler).toContain('outcome.recordsDeleted += 1');
  });

  it('is granted and given a table name for every companion table', () => {
    // A missing grant fails at runtime on a job that runs weekly and destroys
    // data; a missing env var is worse, because the handler would skip the
    // table. Both are checked here rather than discovered in production.
    for (const name of [
      'REACTION_TABLE_NAME',
      'COMMENT_TABLE_NAME',
      'GUEST_BOOK_TABLE_NAME',
      'MOMENT_TABLE_NAME',
    ]) {
      expect(backend).toContain(`reclaimFn.addEnvironment('${name}'`);
      expect(handler).toContain(`process.env.${name}`);
    }
    for (const table of ['reactionTable', 'commentTable', 'guestBookTable', 'momentTable']) {
      expect(backend).toContain(`${table}.grantReadWriteData(reclaimFn)`);
    }
  });

  it('skips an unconfigured companion table rather than treating it as empty', () => {
    // Silently reading a missing table name as "no rows" would let one absent
    // environment variable delete an event's photos and report success while
    // every comment written under them survived.
    expect(handler).toContain('Companion table is not configured');
    expect(handler).toContain('-not-configured');
  });

  it('deletes what guests wrote before the photo records', () => {
    // Dying partway through must leave photos whose comments are gone, which
    // the next run finishes — not comments attached to photos that no longer
    // exist, which is the thing being fixed.
    expect(handlerCode.indexOf('outcome.recordsDeleted += 1')).toBeLessThan(
      handlerCode.indexOf('outcome.photosDeleted += 1'),
    );
  });

  it('retries the event when a guest record could not be deleted', () => {
    // Marking mediaReclaimedAt while rows survive would strand them forever,
    // because the verdict for a reclaimed event is 'already-reclaimed'.
    const block = handlerCode.slice(
      handlerCode.indexOf('for (const record of records)'),
      handlerCode.indexOf('for (const row of rows)'),
    );
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('failed = true');
  });

  it('does not delete a row it cannot attribute to an event', () => {
    // A row with no eventId belongs to no event we can prove. Deleting rows we
    // cannot attribute is not tidying up.
    expect(handler).toContain('if (!eventId || !id || !eventIds.has(eventId)) continue');
  });

  it('is admin-only from the dashboard', () => {
    const schema = read('amplify/data/resource.ts');
    const mutation = schema.slice(schema.indexOf('runStorageReclaim:'));
    expect(mutation.slice(0, 400)).toContain("allow.group('ADMINS')");
  });
});
