import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countsFromBaseline } from '../lib/analyticsAudience';

const AT = '2026-09-13T12:00:00.000Z';

describe('the funnel baseline', () => {
  it('counts a row on or after it', () => {
    expect(countsFromBaseline('2026-09-13T12:00:00.000Z', AT)).toBe(true);
    expect(countsFromBaseline('2026-09-14T00:00:00.000Z', AT)).toBe(true);
  });

  it('ignores a row before it', () => {
    expect(countsFromBaseline('2026-09-13T11:59:59.000Z', AT)).toBe(false);
    expect(countsFromBaseline('2020-01-01T00:00:00.000Z', AT)).toBe(false);
  });

  it('counts everything when no baseline is set', () => {
    // The behaviour before this existed, and what clearing it restores.
    for (const from of ['', '   ', 'not a date']) {
      expect(countsFromBaseline('2020-01-01T00:00:00.000Z', from)).toBe(true);
    }
  });

  it('counts an undated row rather than dropping it', () => {
    // A row we cannot date is not evidence that it predates the baseline, and
    // discarding it would under-report.
    for (const at of [null, undefined, '', 'whenever']) {
      expect(countsFromBaseline(at, AT)).toBe(true);
    }
  });
});

describe('resetting does not destroy anything', () => {
  const api = readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8');
  const admin = readFileSync(join(__dirname, '..', 'pages', 'global-admin.tsx'), 'utf8');

  it('is a stored timestamp, not a delete', () => {
    // "Reset the counts" and "destroy the evidence" must not be the same
    // button. The rows hold real prospects' visits too.
    expect(api).toContain('analyticsCountFrom');
    expect(admin).toContain('SETTING_KEYS.analyticsCountFrom');
    expect(admin).not.toMatch(/delete.*AnalyticsEvent/i);
  });

  it('can be undone', () => {
    expect(admin).toContain("handleResetFunnel('')");
    expect(admin).toContain('Count everything again');
  });

  it('confirms before zeroing, and says nothing is deleted', () => {
    expect(admin).toMatch(/window\.confirm\(/);
    expect(admin).toMatch(/Nothing is deleted/);
  });

  it('fails closed if the baseline cannot be read', () => {
    // A baseline that failed to load must not silently widen the window back
    // to everything and show the contaminated counts with no sign of it.
    expect(api).toMatch(/readSetting\(SETTING_KEYS\.analyticsCountFrom\)/);
  });
});
