import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The DMCA page's content.
 *
 * The agent's details themselves are checked in business-info.test.ts, which
 * owns everything about the address — this file is about whether the page says
 * what 17 U.S.C. § 512 requires it to say.
 */
const page = readFileSync(join(__dirname, '..', 'pages', 'dmca.tsx'), 'utf8');

describe('the DMCA page', () => {
  it('publishes the designated agent', () => {
    // Safe harbour needs the agent reachable from the site, not only filed
    // with the Copyright Office.
    expect(page).toContain('DMCA_AGENT');
    expect(page).toMatch(/AGENT\.address/);
    expect(page).toMatch(/AGENT\.phone/);
    expect(page).toMatch(/AGENT\.email/);
  });

  it('describes both a notice and a counter-notice process', () => {
    // A takedown process with no counter-notice route is not a DMCA process.
    expect(page).toMatch(/counter-notification/i);
    expect(page).toMatch(/penalty of perjury/i);
  });

  it('states the counter-notice jurisdiction consent', () => {
    // § 512(g)(3)(D) — a counter-notice without it is not effective.
    expect(page).toMatch(/Federal District Court/i);
    expect(page).toMatch(/service of process/i);
  });

  it('gives the restoration window', () => {
    expect(page).toMatch(/10 and not more than 14 business days/i);
  });

  it('states a repeat-infringer policy', () => {
    // § 512(i) conditions the whole safe harbour on having one and reasonably
    // implementing it.
    expect(page).toMatch(/repeat infringer/i);
  });

  it('warns about misrepresentation', () => {
    // § 512(f) — worth saying, and it deters the worst notices.
    expect(page).toMatch(/512\(f\)|misrepresent/i);
  });

  it('points elsewhere for takedowns that are not about copyright', () => {
    // The request we will actually get at an event is "I didn't want to be
    // photographed", which is not a copyright matter and should not be routed
    // through a copyright process.
    expect(page).toContain('SUPPORT_EMAIL');
    expect(page).toMatch(/did not want to be photographed|photographed/i);
  });

  it('shows when the registration must be renewed', () => {
    // The designation lapses after three years and nothing else tracks it.
    expect(page).toContain('RENEWAL_DUE');
  });
});
