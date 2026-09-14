import { reviewEvent, type ReviewEventFacts } from '../lib/eventReview';
import { COMMITTED_STATUSES, REFUND_STATUSES } from '../lib/refunds';
import { CLAIM_OPENS_DAYS_AFTER } from '../lib/guestUploadPromise';

const DAY = 24 * 60 * 60 * 1000;
const EVENT_DATE = '2026-05-01';
/** Inside the claim window: a week and a day after the event. */
const IN_WINDOW = new Date(
  Date.parse(`${EVENT_DATE}T00:00:00Z`) + (CLAIM_OPENS_DAYS_AFTER + 1) * DAY,
);

function anEvent(over: Partial<ReviewEventFacts> = {}): ReviewEventFacts {
  return {
    id: 'e1',
    name: 'A wedding',
    tier: 'event',
    paid: true,
    date: EVENT_DATE,
    photoCount: 0,
    guestUploadCount: 0,
    contributorCount: 0,
    ...over,
  };
}

const find = (review: ReturnType<typeof reviewEvent>, label: string) =>
  review.findings.find((entry) => entry.label === label);

describe('when the promise applies', () => {
  it('calls a paid, in-window event with no guest uploads owed', () => {
    const review = reviewEvent(anEvent(), [], IN_WINDOW);
    expect(review.stance).toBe('owed');
    expect(review.promiseBlocker).toBeNull();
    expect(review.headline).toMatch(/owed, not discretionary/);
  });

  it('stops being owed the moment one guest uploads', () => {
    // The whole threshold: one upload by anyone other than the host means the
    // product did the thing it promised.
    const review = reviewEvent(anEvent({ guestUploadCount: 1, photoCount: 1 }), [], IN_WINDOW);
    expect(review.stance).toBe('discretionary');
    expect(review.promiseBlocker).toBe('guests-did-upload');
  });
});

describe('few uploaders is not a failure', () => {
  // The rule this module exists to protect. Plenty of events are meant to have
  // one person uploading, and none of them is owed money for it.
  it('never calls a one-contributor event owed a refund', () => {
    for (const uploads of [1, 2, 5, 40]) {
      const review = reviewEvent(
        anEvent({ guestUploadCount: uploads, photoCount: uploads, contributorCount: 1 }),
        [],
        IN_WINDOW,
      );
      expect(review.stance).toBe('discretionary');
    }
  });

  it('says so in words, where the person deciding will read it', () => {
    const review = reviewEvent(
      anEvent({ guestUploadCount: 30, photoCount: 30, contributorCount: 1 }),
      [],
      IN_WINDOW,
    );
    expect(find(review, 'Unique contributors')?.note).toMatch(/normal/i);
  });

  it('marks Successful Event as context, never as a criterion', () => {
    // It returns a boolean and it is sitting right there, which is exactly why
    // it needs saying: a busy person will otherwise read "No" as "refund them".
    const review = reviewEvent(
      anEvent({ guestUploadCount: 4, photoCount: 4, contributorCount: 2 }),
      [],
      IN_WINDOW,
    );
    const entry = find(review, 'Successful Event');
    expect(entry?.value).toMatch(/^No/);
    expect(entry?.note).toMatch(/[Nn]ot a refund criterion/);
    // And it did not change the stance.
    expect(review.stance).toBe('discretionary');
  });

  it('does not let a successful event suppress a promise that genuinely applies', () => {
    // Counters can disagree — a deleted photo, a stale write. The promise reads
    // guest uploads, and nothing else gets a vote.
    const review = reviewEvent(anEvent({ contributorCount: 9, guestUploadCount: 0 }), [], IN_WINDOW);
    expect(review.stance).toBe('owed');
  });
});

describe('the counts it reports', () => {
  it('separates host uploads from guest uploads', () => {
    const review = reviewEvent(
      anEvent({ photoCount: 12, guestUploadCount: 4, contributorCount: 2 }),
      [],
      IN_WINDOW,
    );
    expect(find(review, 'Photos in the gallery')?.value).toBe('12');
    expect(find(review, 'Guest uploads')?.value).toBe('4');
    expect(find(review, 'Uploaded by the host')?.value).toBe('8');
  });

  it('never reports a negative host count when the counters disagree', () => {
    // guestUploadCount above photoCount should not print "-3 uploaded by the
    // host" and send somebody hunting for a bug that is a stale counter.
    const review = reviewEvent(
      anEvent({ photoCount: 2, guestUploadCount: 5 }),
      [],
      IN_WINDOW,
    );
    expect(find(review, 'Uploaded by the host')?.value).toBe('0');
  });

  it('flags an event with no date rather than guessing a window', () => {
    const review = reviewEvent(anEvent({ date: null }), [], IN_WINDOW);
    expect(review.stance).toBe('discretionary');
    expect(review.promiseBlocker).toBe('no-event-date');
    expect(find(review, 'Event date')?.value).toBe('Not set');
    expect(find(review, 'Claim window')?.value).toBe('Not applicable');
  });
});

describe('money already spoken for', () => {
  it('totals refunds that are approved or recorded', () => {
    const review = reviewEvent(
      anEvent(),
      [
        { id: 'r1', amountCents: 7900, status: 'RECORDED' },
        { id: 'r2', amountCents: 500, status: 'APPROVED' },
      ],
      IN_WINDOW,
    );
    expect(review.alreadyRefundedCents).toBe(8400);
    expect(find(review, 'Already refunded')?.value).toContain('84');
  });

  it('ignores a declined row, which is not money', () => {
    const review = reviewEvent(
      anEvent(),
      [{ id: 'r1', amountCents: 7900, status: 'DECLINED' }],
      IN_WINDOW,
    );
    expect(review.alreadyRefundedCents).toBe(0);
    expect(find(review, 'Already refunded')).toBeUndefined();
  });

  it('still lists a declined row, so the history is visible', () => {
    const rows = [{ id: 'r1', amountCents: 7900, status: 'DECLINED' }];
    expect(reviewEvent(anEvent(), rows, IN_WINDOW).priorRefunds).toEqual(rows);
  });

  it('treats a missing amount as nothing rather than as NaN', () => {
    const review = reviewEvent(anEvent(), [{ id: 'r1', status: 'RECORDED' }], IN_WINDOW);
    expect(review.alreadyRefundedCents).toBe(0);
  });
});

describe('which statuses count as money already out', () => {
  it('uses the ledger\u2019s own list, not a second one written here', () => {
    // The first draft invented ['PENDING', 'APPROVED', 'PAID', 'REFUNDED'].
    // Three of those are not statuses this system has, so RECORDED \u2014 the one
    // meaning a person actually put the money back \u2014 went uncounted, which is
    // the direction that lets a second refund through on top of a first.
    for (const status of COMMITTED_STATUSES) {
      const review = reviewEvent(anEvent(), [{ id: 'r', amountCents: 100, status }], IN_WINDOW);
      expect(review.alreadyRefundedCents).toBe(100);
    }
  });

  it('counts nothing under a status the ledger does not commit', () => {
    const uncommitted = REFUND_STATUSES.filter((s) => !COMMITTED_STATUSES.includes(s));
    expect(uncommitted.length).toBeGreaterThan(0);
    for (const status of uncommitted) {
      const review = reviewEvent(anEvent(), [{ id: 'r', amountCents: 100, status }], IN_WINDOW);
      expect(review.alreadyRefundedCents).toBe(0);
    }
  });
});

describe('what the host said they planned', () => {
  it('is shown once they have claimed, in the words they were shown', () => {
    const review = reviewEvent(
      anEvent(),
      [{ id: 'r1', status: 'REQUESTED', plannedUse: 'guests-upload' }],
      IN_WINDOW,
    );
    expect(find(review, 'The host said they planned')?.value).toBe(
      'I wanted guests to add their own photos',
    );
  });

  it('is absent on an event nobody has claimed against', () => {
    // An empty row would read as an answer.
    expect(find(reviewEvent(anEvent(), [], IN_WINDOW), 'The host said they planned')).toBeUndefined();
  });

  it('flags the shape a bad-faith claim takes', () => {
    // "Guests were meant to upload" next to one uploader and a lot of host
    // photos. Not an accusation \u2014 a prompt to look twice.
    const review = reviewEvent(
      anEvent({ photoCount: 200, guestUploadCount: 0, contributorCount: 1 }),
      [{ id: 'r1', status: 'REQUESTED', plannedUse: 'guests-upload' }],
      IN_WINDOW,
    );
    expect(find(review, 'The host said they planned')?.note).toMatch(/second look/i);
  });

  it('shows an unrecognised answer rather than dropping it', () => {
    const review = reviewEvent(
      anEvent(),
      [{ id: 'r1', status: 'REQUESTED', plannedUse: 'something-older' }],
      IN_WINDOW,
    );
    expect(find(review, 'The host said they planned')?.value).toBe('something-older');
  });
});

describe('every finding is readable', () => {
  it('never renders a bare null or undefined as a value', () => {
    const sparse: ReviewEventFacts = { id: 'e2' };
    for (const entry of reviewEvent(sparse, [], IN_WINDOW).findings) {
      expect(entry.value.length).toBeGreaterThan(0);
      expect(entry.value).not.toMatch(/null|undefined|NaN/);
    }
  });
});
