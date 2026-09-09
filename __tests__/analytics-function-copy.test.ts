import { bodyOf, codeOnly, readSource } from './sourceGuards';

/**
 * The funnel, as the backend actually records it.
 *
 * Amplify functions cannot import from lib/, so the vocabulary exists in four
 * places. The copies are the ones that are controls: the browser can send any
 * string it likes, and only names in the shared list become rows.
 */

const COPIES = [
  'amplify/functions/record-analytics/analytics.ts',
  'amplify/functions/create-event-photo/analytics.ts',
  'amplify/functions/create-event/analytics.ts',
  'amplify/functions/stripe-webhook/analytics.ts',
];

describe('the copies have not drifted', () => {
  it.each(COPIES)('%s matches lib/analytics.ts below the header', (copy) => {
    expect(bodyOf(readSource(copy))).toBe(bodyOf(readSource('lib/analytics.ts')));
  });
});

describe('the recorder', () => {
  const handler = codeOnly(readSource('amplify/functions/record-analytics/handler.ts'));

  it('stores only names the vocabulary knows', () => {
    // The caller is a browser. Without this the table is a free-text sink.
    expect(handler).toContain('isAnalyticsEvent(name)');
  });

  it('stamps the time itself', () => {
    // A browser's clock is a claim, and a funnel ordered by it would be
    // orderable by anyone.
    expect(handler).toContain('const now = new Date().toISOString();');
    expect(handler).not.toContain('arguments?.occurredAt');
  });

  it('bounds what a caller can store', () => {
    expect(handler).toContain('MAX_DETAIL_LENGTH');
    expect(handler).toContain('MAX_SCOPE_LENGTH');
  });

  it('applies the once-per-scope rule as a condition on the write', () => {
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(id)'");
  });

  it('always answers the same, whatever happened', () => {
    // Telemetry must not tell a browser it failed, and a caller that could tell
    // "stored" from "already stored" could probe which milestones an event has
    // reached.
    const returns = handler.match(/return true;/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(3);
    expect(handler).not.toContain('return false');
  });
});

describe('what the server records as fact', () => {
  it('marks an event created, where the row is written', () => {
    const createEvent = codeOnly(readSource('amplify/functions/create-event/handler.ts'));
    expect(createEvent).toContain("fireAnalytics('event_created', id");
  });

  it('marks a purchase from the webhook, keyed so a replay adds nothing', () => {
    // Stripe retries. One event is bought once.
    const webhook = codeOnly(readSource('amplify/functions/stripe-webhook/handler.ts'));
    expect(webhook).toContain("fireAnalytics('purchase_completed', eventId");
    expect(webhook).toContain("fireAnalytics('retention_extension_purchased', eventId)");
  });

  it('marks activation on a guest upload, never a host one', () => {
    // A host uploading to their own event is not the product working. That
    // distinction is the whole reason the event is called first_guest_upload.
    const photo = codeOnly(readSource('amplify/functions/create-event-photo/handler.ts'));
    expect(photo).toContain('if (!ANALYTICS_TABLE || !facts.isGuestUpload) return;');
    expect(photo).toContain("fireAnalytics('first_guest_upload', eventId)");
  });

  it('derives milestones from the counters before and after the reservation', () => {
    // Not from a re-read, which could race another upload and fire the same
    // milestone twice.
    const photo = codeOnly(readSource('amplify/functions/create-event-photo/handler.ts'));
    expect(photo).toContain("update.ReturnValues = 'ALL_NEW';");
    expect(photo).toContain('milestonesCrossed(before.guestUploads, after.guestUploads');
  });

  it('takes the Successful Event line from the one definition', () => {
    // Seven strategy documents key off this metric; two implementations of it
    // would disagree in public.
    const photo = codeOnly(readSource('amplify/functions/create-event-photo/handler.ts'));
    expect(photo).toContain('isSuccessfulEvent({');
    expect(photo).toContain("fireAnalytics('successful_event', eventId)");
  });

  it('never lets telemetry fail the thing it is describing', () => {
    // A photo somebody's guests are waiting for must not depend on a counter.
    const photo = codeOnly(readSource('amplify/functions/create-event-photo/handler.ts'));
    expect(photo).toContain('void recordUploadMilestones(');
    const createEvent = codeOnly(readSource('amplify/functions/create-event/handler.ts'));
    expect(createEvent).toContain("void fireAnalytics('event_created'");
  });
});

describe('the grants', () => {
  const backend = codeOnly(readSource('amplify/backend.ts'));

  it('are write-only for every function that records', () => {
    expect(backend).toContain('analyticsTable.grantWriteData(recordAnalyticsFn)');
    expect(backend).toContain('analyticsTable.grantWriteData(fn)');
    expect(backend).not.toContain('analyticsTable.grantReadWriteData');
  });

  it('reach no function outside the data stack', () => {
    // sanitize-upload lives in the storage stack. Granting it a data-stack
    // table is what broke four deploys, and this is the same table shape.
    expect(backend).not.toContain('analyticsTable.grantWriteData(sanitizeFn)');
  });
});
