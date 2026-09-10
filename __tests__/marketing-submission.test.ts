import { bodyOf, codeOnly, readSource } from './sourceGuards';
import { MARKETING_TIERS, RELEASE_VERSION, tierByKey } from '../lib/marketingRelease';

/**
 * The submission path, where a customer's photos become an offer.
 *
 * The thing being protected here is not data integrity, it is consent. A row on
 * this table is the record of what a named person agreed to let SharePix
 * publish, so what it claims has to be decided by the server on the day, never
 * assembled from whatever the browser sent.
 */

describe('the copied modules have not drifted', () => {
  it('marketingRelease matches lib/', () => {
    expect(bodyOf(readSource('amplify/functions/submit-marketing/marketingRelease.ts'))).toBe(
      bodyOf(readSource('lib/marketingRelease.ts')),
    );
  });

  it('analytics matches lib/', () => {
    expect(bodyOf(readSource('amplify/functions/submit-marketing/analytics.ts'))).toBe(
      bodyOf(readSource('lib/analytics.ts')),
    );
  });
});

describe('the submit handler', () => {
  const handler = codeOnly(readSource('amplify/functions/submit-marketing/handler.ts'));

  it('takes the release wording and the moment from the server', () => {
    // Which words somebody agreed to, and when, is the entire legal content of
    // the row. A version number sent by a browser records nothing.
    expect(handler).toContain('releaseVersion: { S: RELEASE_VERSION }');
    expect(handler).toContain('releaseAcceptedAt: { S: now }');
    expect(handler).not.toContain('arguments?.releaseVersion');
    expect(handler).not.toContain('arguments?.releaseAcceptedAt');
  });

  it('refuses a submission that carries no rights confirmation', () => {
    expect(handler).toContain("if (event.arguments?.rightsConfirmed !== true)");
  });

  it('starts every asset PENDING, whatever the request said', () => {
    // An asset arriving marked accepted would be a licence nobody granted.
    expect(handler).toContain("decision: 'PENDING'");
    expect(handler).not.toContain("decision: 'ACCEPTED'");
    expect(handler).not.toContain('arguments?.assets');
  });

  it('checks the event belongs to the caller, and says nothing else', () => {
    // One answer for "no such event" and "not yours", so this cannot be used to
    // enumerate event ids.
    expect(handler).toContain("(row.owner?.S ?? '').includes(sub)");
    const notFound = handler.match(/That event could not be found\./g) ?? [];
    expect(notFound).toHaveLength(1);
  });

  it('takes the identity from the request context, not the arguments', () => {
    expect(handler).toContain('event.identity as { sub?: string }');
    expect(handler).not.toContain('arguments?.customer');
    expect(handler).not.toContain('arguments?.owner');
  });

  it('keys the row on the event, so a reload cannot create a second consent record', () => {
    expect(handler).toContain('id: { S: eventId }');
    expect(handler).toContain("ConditionExpression: 'attribute_not_exists(id)'");
  });

  it('bounds the photo list to the chosen tier', () => {
    expect(handler).toContain('.slice(0, tier.maxAssets)');
    expect(handler).toContain('photoIds.length < tier.minAssets');
  });

  it('deduplicates the photo ids', () => {
    // Ten copies of one photo is not ten photos, and would pass a minimum.
    expect(handler).toContain('[...new Set(requested)]');
  });

  it('bounds the testimonial', () => {
    expect(handler).toContain('.slice(0, MAX_TESTIMONIAL)');
  });

  it('never lets the analytics write fail the submission', () => {
    // A consent record must not depend on a counter.
    expect(handler).toContain("analyticsId('featured_event_submitted'");
    expect(handler).toContain('.catch(() => undefined)');
  });
});

describe('the submission page', () => {
  const page = codeOnly(readSource('pages/featured/[eventId].tsx'));
  const prose = readSource('pages/featured/[eventId].tsx');

  it('pre-ticks nothing', () => {
    // A confirmation that was on by default confirms nothing.
    expect(page).toContain('useState(false)');
    expect(page).not.toContain('useState(true)');
  });

  it('will not submit without the confirmation and the minimum', () => {
    expect(page).toContain('disabled={!enough || !confirmed');
  });

  it('says what the reward is before they choose', () => {
    expect(page).toContain('refundValueUsd(option, eventPriceUsd)');
  });

  it('uses the one wording for the permission', () => {
    expect(page).toContain('CONSENT_SUMMARY');
  });

  it('does not tell anyone their photos are published', () => {
    expect(prose).toContain('Nothing is published unless');
  });
});

describe('the tiers', () => {
  it('resolve by key, and reject anything else', () => {
    for (const tier of MARKETING_TIERS) expect(tierByKey(tier.key)).toBe(tier);
    expect(tierByKey('spotlight_story; drop table')).toBeUndefined();
    expect(tierByKey('')).toBeUndefined();
  });

  it('carry a release version the row can be read back against', () => {
    expect(RELEASE_VERSION).toMatch(/^marketing-release-v\d/);
  });
});
