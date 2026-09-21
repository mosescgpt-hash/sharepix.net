import { bodyOf, readSource } from './sourceGuards';

import {
  ANCHOR_UPLOAD_COUNT,
  EVENT_DATE_TOO_FAR_MESSAGE,
  EVENT_DATE_TOO_OLD_MESSAGE,
  MAX_EVENT_DATE_DAYS_AHEAD,
  MAX_EVENT_DATE_DAYS_BEHIND,
  UPLOAD_WINDOW_DAYS,
  accessExpiresAtFor,
  anchoredWindowEnd,
  eventDateProblem,
  latestEventDate,
  rescheduledWindow,
  windowEndsAtFor,
} from '../lib/uploadWindowStart';
import { UPLOAD_WINDOW_DAYS as PRICING_WINDOW_DAYS } from '../lib/pricing';

/**
 * When the sixty days start.
 *
 * They used to start when the event row was written, which is the moment a host
 * is least likely to want them. Somebody setting their wedding gallery up six
 * weeks early spent six weeks of a sixty-day window on an empty gallery, and
 * somebody three months early found it closed on the day.
 *
 * Nothing failed. Every reader downstream honoured `uploadWindowEndsAt` exactly
 * as it was written.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-01T12:00:00.000Z');
const daysFromNow = (n: number) =>
  new Date(NOW.getTime() + n * DAY).toISOString().slice(0, 10);

describe('the window starts at the event', () => {
  it('counts from the end of the event day, not from creation', () => {
    // The whole change, in one assertion. An event three weeks out gets its
    // sixty days starting three weeks from now.
    const end = windowEndsAtFor(daysFromNow(21), NOW);
    const eventEnd = Date.parse(`${daysFromNow(21)}T00:00:00Z`) + DAY;
    expect(Date.parse(end)).toBe(eventEnd + UPLOAD_WINDOW_DAYS * DAY);
  });

  it('gives the host the whole of their event day', () => {
    // An event dated today still has the evening to come. Counting from
    // midnight at the start of the day would take a day off a wedding.
    const today = NOW.toISOString().slice(0, 10);
    const end = Date.parse(windowEndsAtFor(today, NOW));
    expect(end).toBeGreaterThan(NOW.getTime() + UPLOAD_WINDOW_DAYS * DAY);
  });

  it('runs from creation for an event that already happened', () => {
    // A host collecting photos after the fact. Counting from the date would
    // hand them a gallery that closed before they opened it — the original bug
    // with the sign reversed.
    const end = windowEndsAtFor(daysFromNow(-30), NOW);
    expect(Date.parse(end)).toBe(NOW.getTime() + UPLOAD_WINDOW_DAYS * DAY);
  });

  it('runs from creation when there is no date', () => {
    // Provisional. The fifth upload re-stamps it — see below.
    for (const missing of [null, undefined, '', '   ']) {
      expect(Date.parse(windowEndsAtFor(missing, NOW))).toBe(
        NOW.getTime() + UPLOAD_WINDOW_DAYS * DAY,
      );
    }
  });

  it('runs from creation rather than throwing on rubbish', () => {
    // The sanitizers drop a malformed date before it reaches here. If one ever
    // did get through, the failure worth avoiding is an event that cannot be
    // created at all.
    expect(Date.parse(windowEndsAtFor('not a date', NOW))).toBe(
      NOW.getTime() + UPLOAD_WINDOW_DAYS * DAY,
    );
  });
});

describe('the gallery moves with the window', () => {
  it('keeps retention counted from the window, not from creation', () => {
    // accessDays has always been window + retention. With the window able to
    // start later, counting the gallery from creation would let the window
    // outlive the gallery it belongs to.
    const windowEnd = windowEndsAtFor(daysFromNow(60), NOW);
    const access = accessExpiresAtFor(windowEnd, UPLOAD_WINDOW_DAYS + 365, NOW);
    expect(Date.parse(access) - Date.parse(windowEnd)).toBe(365 * DAY);
  });

  it('never returns a gallery that ends before the window', () => {
    const windowEnd = windowEndsAtFor(daysFromNow(30), NOW);
    // Even a nonsensical plan with no retention at all.
    const access = accessExpiresAtFor(windowEnd, UPLOAD_WINDOW_DAYS, NOW);
    expect(Date.parse(access)).toBeGreaterThanOrEqual(Date.parse(windowEnd));
    expect(Date.parse(accessExpiresAtFor(windowEnd, 0, NOW))).toBeGreaterThanOrEqual(
      Date.parse(windowEnd),
    );
  });
});

describe('how far out a date may be', () => {
  it('accepts a date inside the ceiling', () => {
    expect(eventDateProblem(daysFromNow(MAX_EVENT_DATE_DAYS_AHEAD - 1), NOW)).toBeNull();
  });

  it('refuses one past it, and says why', () => {
    // Uncapped, "2099-06-01" is a permanent gallery for seventy-nine dollars.
    const problem = eventDateProblem(daysFromNow(MAX_EVENT_DATE_DAYS_AHEAD + 2), NOW);
    expect(problem).toBe(EVENT_DATE_TOO_FAR_MESSAGE);
    // The refusal has to tell somebody what to do instead, because the thing
    // they were doing — planning ahead — was reasonable.
    expect(problem).toContain('come back nearer the time');
  });

  it('is well under a year', () => {
    // The requirement was "for sure less than a year". This pins it so a later
    // loosening is a deliberate edit to a test rather than a number nudged.
    expect(MAX_EVENT_DATE_DAYS_AHEAD).toBeLessThan(365);
    expect(MAX_EVENT_DATE_DAYS_AHEAD).toBe(90);
  });

  it('catches a year typed a century wrong', () => {
    expect(eventDateProblem('1926-06-01', NOW)).toBe(EVENT_DATE_TOO_OLD_MESSAGE);
    expect(eventDateProblem(daysFromNow(-(MAX_EVENT_DATE_DAYS_BEHIND - 1)), NOW)).toBeNull();
  });

  it('says nothing about an absent date, which is allowed', () => {
    for (const missing of [null, undefined, '', '  ']) {
      expect(eventDateProblem(missing, NOW)).toBeNull();
    }
  });

  it('leaves malformed dates to the sanitizer rather than reporting twice', () => {
    // sanitizeEventDate drops these to null. Two different refusals for one
    // mistake is how a host ends up reading the wrong one.
    expect(eventDateProblem('June 1st', NOW)).toBeNull();
  });

  it('hands the form a max the browser can enforce', () => {
    expect(latestEventDate(NOW)).toBe(daysFromNow(MAX_EVENT_DATE_DAYS_AHEAD));
    expect(eventDateProblem(latestEventDate(NOW), NOW)).toBeNull();
  });
});

describe('an undated event is anchored by its fifth upload', () => {
  const open = new Date(NOW.getTime() + 40 * DAY).toISOString();
  const base = {
    eventDate: null,
    currentEndsAt: open,
    alreadyAnchored: false,
    photoCountBefore: ANCHOR_UPLOAD_COUNT - 1,
  };

  it('re-stamps the window on the fifth upload', () => {
    expect(Date.parse(anchoredWindowEnd(base, NOW) ?? '')).toBe(
      NOW.getTime() + UPLOAD_WINDOW_DAYS * DAY,
    );
  });

  it('does nothing for the first four', () => {
    // A host photographs their own table card to check the code works, and
    // that upload is indistinguishable from a guest's. One upload is as likely
    // to be a test as the start of a party.
    for (let before = 0; before < ANCHOR_UPLOAD_COUNT - 1; before += 1) {
      expect(anchoredWindowEnd({ ...base, photoCountBefore: before }, NOW)).toBeNull();
    }
  });

  it('still fires for an event that is already past five', () => {
    // Events live when this ships have counts well above the threshold, and
    // the marker is what stops it from firing twice — not the exact count.
    expect(anchoredWindowEnd({ ...base, photoCountBefore: 240 }, NOW)).not.toBeNull();
  });

  it('leaves a dated event alone', () => {
    // It already counts from the right place, and overwriting it would discard
    // what the host chose.
    expect(anchoredWindowEnd({ ...base, eventDate: daysFromNow(3) }, NOW)).toBeNull();
  });

  it('fires once', () => {
    expect(anchoredWindowEnd({ ...base, alreadyAnchored: true }, NOW)).toBeNull();
  });

  it('never shortens a window somebody paid for', () => {
    // The obvious way to write this is "set it to now + 60 days", which takes
    // five months off an event whose window was extended or set from a date.
    const far = new Date(NOW.getTime() + 200 * DAY).toISOString();
    expect(anchoredWindowEnd({ ...base, currentEndsAt: far }, NOW)).toBeNull();
  });

  it('gives no deadline to an event that never had one', () => {
    // Events predating the lifecycle model carry no window at all, and
    // uploadWindowClosed deliberately reads that as open. Stamping one here
    // would be this function taking something away rather than giving it.
    for (const none of [null, undefined, '', 'last Tuesday']) {
      expect(anchoredWindowEnd({ ...base, currentEndsAt: none }, NOW)).toBeNull();
    }
  });
});

describe('changing the date moves the window with it', () => {
  const open = new Date(NOW.getTime() + 40 * DAY).toISOString();
  const gallery = new Date(NOW.getTime() + 400 * DAY).toISOString();
  const base = { date: null as string | null, currentEndsAt: open, currentAccessExpiresAt: gallery };

  it('re-derives the window from the new date', () => {
    const next = rescheduledWindow({ ...base, date: daysFromNow(20) }, NOW);
    expect(next?.uploadWindowEndsAt).toBe(windowEndsAtFor(daysFromNow(20), NOW));
  });

  it('moves the gallery by the same amount, not to a recomputed plan date', () => {
    // An event keeps the retention it was sold, including anything an admin
    // granted it. Recomputing from the tier would quietly take that back.
    const next = rescheduledWindow({ ...base, date: daysFromNow(20) }, NOW);
    const shift = Date.parse(next?.uploadWindowEndsAt ?? '') - Date.parse(open);
    expect(Date.parse(next?.accessExpiresAt ?? '')).toBe(Date.parse(gallery) + shift);
  });

  it('shortens as readily as it lengthens', () => {
    // Safe only because the date locks at the first upload: an event with no
    // photos has nothing invested in its current window. A host who set the
    // date a month out and then corrected it should not be holding a month of
    // storage nobody will use.
    const far = new Date(NOW.getTime() + 200 * DAY).toISOString();
    const next = rescheduledWindow(
      { ...base, date: daysFromNow(10), currentEndsAt: far },
      NOW,
    );
    expect(Date.parse(next?.uploadWindowEndsAt ?? '')).toBeLessThan(Date.parse(far));
  });

  it('does nothing when the window would not actually move', () => {
    const settled = windowEndsAtFor(daysFromNow(20), NOW);
    expect(
      rescheduledWindow({ ...base, date: daysFromNow(20), currentEndsAt: settled }, NOW),
    ).toBeNull();
  });

  it('gives no deadline to an event that never had one', () => {
    for (const none of [null, undefined, '', 'last Tuesday']) {
      expect(rescheduledWindow({ ...base, date: daysFromNow(20), currentEndsAt: none }, NOW))
        .toBeNull();
    }
  });

  it('leaves an unreadable gallery date alone rather than inventing one', () => {
    const next = rescheduledWindow(
      { ...base, date: daysFromNow(20), currentAccessExpiresAt: 'soon' },
      NOW,
    );
    expect(next?.uploadWindowEndsAt).toBeTruthy();
    expect(next?.accessExpiresAt).toBeNull();
  });
});

describe('the rules are actually wired in', () => {
  // The rules being right is half of it. The other half is the half that has
  // failed in this repository before: a correct module nothing calls.
  const create = readSource('amplify/functions/create-event/newEvent.ts');
  const photo = readSource('amplify/functions/create-event-photo/handler.ts');
  const schema = readSource('amplify/data/resource.ts');

  it('derives the new event’s window from its date', () => {
    expect(create).toContain('windowEndsAtFor(cleanDate, now)');
    expect(create).toContain('accessExpiresAtFor(uploadWindowEndsAt, plan.accessDays, now)');
  });

  it('refuses the date before deriving anything from it', () => {
    expect(create).toContain('const dateProblem = eventDateProblem(cleanDate, now);');
    expect(create).toContain('if (dateProblem) throw new Error(dateProblem);');
  });

  it('no longer counts either date from creation', () => {
    // The two expressions that were the bug.
    expect(create).not.toContain('now.getTime() + UPLOAD_WINDOW_DAYS * DAY_MS');
    expect(create).not.toContain('now.getTime() + plan.accessDays * DAY_MS');
  });

  it('anchors an undated event from the upload path', () => {
    expect(photo).toContain('anchoredWindowEnd(');
    expect(photo).toContain("eventDate: ev.date?.S ?? null,");
  });

  it('writes the anchor under a condition that can only fire once', () => {
    // Without attribute_not_exists, two uploads racing to be the fifth both
    // re-stamp. Without the uploadWindowEndsAt check, an extension bought
    // between the read and this write is overwritten by a value derived
    // before it existed.
    expect(photo).toContain('attribute_not_exists(uploadWindowAnchoredAt) AND uploadWindowEndsAt = :seen');
  });

  it('never lets the anchor fail an upload', () => {
    // A photo that is safely stored must not fail because a counter could not
    // be written. Same rule as the milestones beside it.
    const block = photo.slice(photo.indexOf('const anchorEnd'), photo.indexOf('// Funnel milestones'));
    expect(block).toContain('.catch(() => undefined)');
    expect(block).not.toContain('await dynamo');
  });

  it('caps the date on edit too, not only at creation', () => {
    // Without this, a host sets a near date, saves, and then edits it to 2099
    // — which is exactly what the ceiling at creation exists to prevent.
    const settings = readSource('amplify/functions/update-event/settings.ts');
    expect(settings).toContain('const problem = eventDateProblem(date, now);');
    expect(settings).toContain('if (problem) return { ok: false, reason: problem };');
  });

  it('moves the window from the handler, not through the allow-list', () => {
    // EDITABLE_FIELDS names what a REQUEST may write, and uploadWindowEndsAt
    // must never be in it — that field is what an upload-window extension is
    // sold to move. The handler recomputing it from a date it just validated
    // is a different thing, and the two must not be confused.
    const handler = readSource('amplify/functions/update-event/handler.ts');
    const settings = readSource('amplify/functions/update-event/settings.ts');
    expect(handler).toContain('rescheduledWindow({');
    expect(handler).toContain("'date' in result.patch.set || result.patch.remove.includes('date')");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EDITABLE_FIELDS } = require('../amplify/functions/update-event/settings') as {
      EDITABLE_FIELDS: readonly string[];
    };
    expect(EDITABLE_FIELDS).not.toContain('uploadWindowEndsAt');
    expect(EDITABLE_FIELDS).not.toContain('accessExpiresAt');
    expect(settings).not.toContain('set.uploadWindowEndsAt');
  });

  it('caps the date in both places a host can pick one', () => {
    // A date input's max is trivially edited and the server is the fence. The
    // point is that nobody fills a form in and is then turned away by a rule
    // the form never mentioned.
    for (const page of ['pages/create-event.tsx', 'pages/event/[eventId]/admin.tsx']) {
      expect(readSource(page)).toContain('max={latestEventDate()}');
    }
  });

  it('tells a host what the date decides', () => {
    // It was a bare optional field. It now sets when uploads close, which is
    // the single thing hosts write in about.
    const form = readSource('pages/create-event.tsx');
    expect(form).toContain('Guests can upload for ${UPLOAD_WINDOW_DAYS} days after this date.');
  });

  it('stops the help articles saying the window runs from creation', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { HELP_ARTICLES } = require('../lib/help') as {
      HELP_ARTICLES: Array<{ summary: string; blocks: Array<{ text?: string }> }>;
    };
    const text = HELP_ARTICLES.map((a) =>
      [a.summary, ...a.blocks.map((b) => b.text ?? '')].join(' '),
    ).join(' ');
    expect(text).not.toContain('from when the event is created');
    expect(text).not.toContain('from when the event was created');
    expect(text).toContain('60 days from the event date');
  });

  it('declares the marker the condition depends on', () => {
    // The shape of a bug this repository has already had: a pipeline reading a
    // field that was never on the model, failing silently every time.
    expect(schema).toContain('uploadWindowAnchoredAt: a.datetime()');
  });
});

describe('the copies have not drifted', () => {
  const source = bodyOf(readSource('lib/uploadWindowStart.ts'));

  it.each([
    'amplify/functions/create-event/uploadWindowStart.ts',
    'amplify/functions/create-event-photo/uploadWindowStart.ts',
    'amplify/functions/update-event/uploadWindowStart.ts',
  ])('%s is byte-identical below the header', (path) => {
    expect(bodyOf(readSource(path))).toBe(source);
  });

  it('agrees with the window length the pricing table sells', () => {
    // Three places now carry the number. A mismatch would mean the page sold
    // one window and the row stored another.
    expect(UPLOAD_WINDOW_DAYS).toBe(PRICING_WINDOW_DAYS);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lambda = require('../amplify/functions/create-event/newEvent') as {
      UPLOAD_WINDOW_DAYS: number;
    };
    expect(lambda.UPLOAD_WINDOW_DAYS).toBe(UPLOAD_WINDOW_DAYS);
  });
});
