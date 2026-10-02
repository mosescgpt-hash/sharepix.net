import {
  REVIEW_FLAGGED_COUNT,
  REVIEW_FLAGGED_SHARE,
  REVIEW_MIN_FLAGGED_FOR_SHARE,
  flaggedShare,
  flaggedSinceCleared,
  needsContentReview,
} from '../lib/contentReview';
import { eventStatusNotices } from '../lib/eventStatus';
import { canSign } from '../amplify/functions/media-url/access';
import { bodyOf, codeOnly, proseOf, readSource } from './sourceGuards';

/**
 * Content review: the operator's view of events whose photos screening keeps
 * flagging, and what closing one does.
 */

describe('the rule', () => {
  it('queues an event at the flagged count on its own', () => {
    expect(needsContentReview({ flaggedCount: REVIEW_FLAGGED_COUNT, photoCount: 2000 })).toBe(true);
    expect(needsContentReview({ flaggedCount: REVIEW_FLAGGED_COUNT - 1, photoCount: 2000 })).toBe(
      false,
    );
  });

  it('queues a small event that is mostly flagged, but not one bad photo', () => {
    // 5 of 20 is 25%: a small event that is largely explicit.
    expect(needsContentReview({ flaggedCount: REVIEW_MIN_FLAGGED_FOR_SHARE, photoCount: 20 })).toBe(
      true,
    );
    // 1 of 3 is 33%, but one flag is not a pattern.
    expect(needsContentReview({ flaggedCount: 1, photoCount: 3 })).toBe(false);
    // Enough flags, but a small share of a big event.
    expect(needsContentReview({ flaggedCount: 6, photoCount: 500 })).toBe(false);
    expect(REVIEW_FLAGGED_SHARE).toBe(0.2);
  });

  it('only counts flags since the event was last cleared', () => {
    const cleared = { flaggedCount: 14, photoCount: 2000, contentReviewClearedCount: 12 };
    expect(flaggedSinceCleared(cleared)).toBe(2);
    expect(needsContentReview(cleared)).toBe(false);
    expect(needsContentReview({ ...cleared, flaggedCount: 22 })).toBe(true);
  });

  it('never re-queues an event that is already closed', () => {
    expect(
      needsContentReview({ flaggedCount: 50, photoCount: 60, takenDownAt: '2026-10-02T00:00:00Z' }),
    ).toBe(false);
  });

  it('handles missing and empty counts', () => {
    expect(needsContentReview(null)).toBe(false);
    expect(needsContentReview({})).toBe(false);
    expect(flaggedShare({ flaggedCount: 3, photoCount: 0 })).toBe(0);
  });
});

describe('the upload function', () => {
  const handler = codeOnly(readSource('amplify/functions/create-event-photo/handler.ts'));
  const record = handler.slice(
    handler.indexOf('async function recordFlagged'),
    handler.indexOf('async function sendAlertEmail'),
  );

  it('uses a byte-identical copy of the rule', () => {
    expect(bodyOf(readSource('amplify/functions/create-event-photo/contentReview.ts'))).toBe(
      bodyOf(readSource('lib/contentReview.ts')),
    );
  });

  it('counts every flagged photo on its event', () => {
    expect(record).toContain("UpdateExpression: 'ADD flaggedCount :one'");
    expect(handler).toContain('await recordFlagged(eventId, eventName);');
  });

  it('emails the operator once per crossing, not once per photo', () => {
    expect(record).toContain("ConditionExpression: 'attribute_not_exists(contentReviewAlertedAt)'");
    expect(record).toContain('needsContentReview(facts)');
  });

  it('never puts an image or a media link in that email', () => {
    // If the content is illegal, attaching it is distributing it.
    expect(record).not.toContain('GetObjectCommand');
    expect(record).not.toContain('Raw:');
    expect(record).not.toContain('previewKey');
    expect(record).toContain('Simple:');
  });

  it('never closes anything on its own', () => {
    expect(record).not.toContain('takenDownAt =');
    expect(record).not.toContain('uploadsClosed');
  });
});

describe('closing an event', () => {
  const event = {
    owner: 'host-sub::host',
    guestResolution: 'full' as const,
    takenDown: true,
  };
  const key = 'events/ev1/photos/abc.jpg';

  it('signs nothing for guests or the host, and everything an admin needs', () => {
    expect(canSign({ eventId: 'ev1', key, event, caller: null }).allowed).toBe(false);
    expect(canSign({ eventId: 'ev1', key, event, caller: { sub: 'host-sub' } }).allowed).toBe(false);
    expect(
      canSign({ eventId: 'ev1', key, event, caller: { sub: 'x', groups: ['ADMINS'] } }).allowed,
    ).toBe(true);
    // And an open event is unchanged.
    expect(
      canSign({ eventId: 'ev1', key, event: { ...event, takenDown: false }, caller: { sub: 'host-sub' } })
        .allowed,
    ).toBe(true);
  });

  it('lists nothing to anyone but an admin', () => {
    const list = codeOnly(readSource('amplify/functions/list-event-photos/handler.ts'));
    expect(list).toContain(
      "if (!(identity?.groups ?? []).includes('ADMINS') && (await isTakenDown(eventId))) return [];",
    );
    expect(codeOnly(readSource('amplify/backend.ts'))).toContain('eventTable.grantReadData(listFn)');
  });

  it('stops uploads and deletes nothing', () => {
    const api = readSource('lib/api.ts');
    const takeDown = api.slice(
      api.indexOf('export async function takeDownEvent'),
      api.indexOf('export async function restoreTakenDownEvent'),
    );
    expect(takeDown).toContain('uploadsClosed: true');
    expect(takeDown).toContain("usageStatus: 'RESTRICTED'");
    expect(codeOnly(takeDown)).not.toMatch(/delete/i);
  });

  it('tells the host, and only that', () => {
    const notices = eventStatusNotices({ tier: 'plus', paid: false, takenDownAt: '2026-10-02T00:00:00Z' });
    expect(notices.map((n) => n.kind)).toEqual(['taken-down']);
  });

  it('can disable an account by its id, which is all an event knows', () => {
    const fn = codeOnly(readSource('amplify/functions/admin-user-actions/handler.ts'));
    // The sub goes into a Cognito filter string, so it is validated first.
    expect(fn).toContain('/^[0-9a-f-]{36}$/i.test(subArg)');
    expect(fn).toContain('`sub = "${subArg}"`');
  });
});

describe('what the terms say', () => {
  const terms = proseOf(readSource('pages/terms.tsx'));

  it('reserves the right to close events and accounts for malicious, illegal or abusive use', () => {
    expect(terms).toContain('at our discretion and without notice');
    expect(terms).toContain('close or remove an event');
    expect(terms).toContain('malicious, illegal or abusive');
  });

  it('says illegal content is preserved and may be reported', () => {
    expect(terms).toContain('preserved rather than deleted');
    expect(terms).toContain('National Center for Missing');
  });
});

describe('a closed event is preserved', () => {
  it('is never reclaimed by the storage job', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { reclaimVerdict } = require('../lib/storageReclaim');
    const old = { uploadWindowEndsAt: '2020-01-01T00:00:00Z', tier: 'plus' };
    expect(reclaimVerdict(old, 365).reclaim).toBe(true);
    expect(reclaimVerdict({ ...old, takenDownAt: '2026-10-02T00:00:00Z' }, 365)).toMatchObject({
      reclaim: false,
      reason: 'taken-down',
    });
    const job = codeOnly(readSource('amplify/functions/reclaim-storage/handler.ts'));
    expect(job).toContain('takenDownAt: item.takenDownAt?.S ?? null');
  });

  it('cannot have its photos deleted by the host', () => {
    const fn = codeOnly(readSource('amplify/functions/delete-event-photo/handler.ts'));
    expect(fn).toContain('if (ev?.Item?.takenDownAt?.S)');
  });
});
